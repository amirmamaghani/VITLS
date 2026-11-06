import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { ingestBatchSchema, type IngestBatchInput } from "@vitls/health-ingest";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../../db";
import { setupTestDb } from "../../test/db";
import { purgeExpiredArchives } from "./archive";
import { createPairing, redeemPairing, type DeviceIdentity, authenticateDeviceToken } from "./devices";
import { ingestBatch, type Entitlements } from "./ingest";

const FREE: Entitlements = { intraday: false, rawRetentionDays: 30 };
const PREMIUM: Entitlements = { intraday: true, rawRetentionDays: 365 };

async function pairDevice(userEmail: string, orgId: string): Promise<DeviceIdentity> {
  const { code } = await createPairing({ userEmail, orgId });
  const { token } = await redeemPairing(code, { platform: "ios" });
  return (await authenticateDeviceToken(token))!;
}

function batch(overrides: Partial<IngestBatchInput> = {}) {
  return ingestBatchSchema.parse({
    batchId: randomUUID(),
    sentAt: "2026-10-01T06:00:00Z",
    source: { provider: "garmin", via: "companion" },
    ...overrides,
  });
}

const asUser = <T>(identity: DeviceIdentity, fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail: identity.userEmail, orgId: identity.orgId ?? undefined }, fn) as Promise<T>;

describe("ingestBatch", () => {
  let alice: DeviceIdentity;
  let bob: DeviceIdentity;

  beforeAll(async () => {
    await setupTestDb();
    alice = await pairDevice("alice@example.com", "org_alice");
    bob = await pairDevice("bob@example.com", "org_bob");
  });

  it("stores swim fields and keeps old workouts without them", async () => {
    await ingestBatch({
      identity: alice,
      entitlements: FREE,
      batch: batch({
        workouts: [
          { externalId: "sw1", type: "swimming", start: "2026-09-30T07:00:00Z", end: "2026-09-30T08:00:00Z", poolLengthM: 25, strokes: 900 },
          { externalId: "sw2", type: "run", start: "2026-09-30T09:00:00Z", end: "2026-09-30T10:00:00Z" },
        ],
      }),
    });
    const db = getDb();
    const rows = await db.select().from(schema.workouts).where(and(eq(schema.workouts.ownerEmail, alice.userEmail), inArray(schema.workouts.externalId, ["sw1", "sw2"])));
    const by = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(by.sw1).toMatchObject({ poolLengthM: 25, strokes: 900 });
    expect(by.sw2).toMatchObject({ poolLengthM: null, strokes: null });
    await ingestBatch({ identity: alice, entitlements: FREE, batch: batch({ workouts: [{ externalId: "sw1", type: "swimming", start: "2026-09-30T07:00:00Z", end: "2026-09-30T08:00:00Z", poolLengthM: 50, strokes: 700 }] }) });
    const [again] = await db.select().from(schema.workouts).where(and(eq(schema.workouts.ownerEmail, alice.userEmail), eq(schema.workouts.externalId, "sw1")));
    expect(again).toMatchObject({ poolLengthM: 50, strokes: 700 });
  });

  it("stores daily, point, sleep and workout data in canonical units", async () => {
    const result = await ingestBatch({
      identity: alice,
      entitlements: FREE,
      batch: batch({
        daily: [{ externalId: "d1", date: "2026-09-30", metric: "steps", value: 9000, unit: "count" }],
        points: [{ externalId: "p1", at: "2026-09-30T06:10:00+02:00", metric: "weight", value: 82400, unit: "g" }],
        sleep: [{ externalId: "s1", start: "2026-09-29T22:30:00Z", end: "2026-09-30T06:00:00Z", stages: [{ stage: "deep", start: "2026-09-29T23:00:00Z", end: "2026-09-29T23:40:00Z" }] }],
        workouts: [{ externalId: "w1", type: "strength_training", start: "2026-09-30T17:00:00Z", end: "2026-09-30T18:00:00Z", sets: [{ exercise: "squat", reps: 5, weightKg: 100 }] }],
      }),
    });
    expect(result).toMatchObject({ duplicate: false, stored: { daily: 1, points: 1, sleep: 1, workouts: 1, intraday: 0 } });

    const db = getDb();
    const [weight] = await db.select().from(schema.pointMetrics).where(eq(schema.pointMetrics.ownerEmail, alice.userEmail));
    expect(weight).toMatchObject({ metric: "weight", value: 82.4, unit: "kg", orgId: "org_alice", zoneOffset: null });

    const [sleep] = await asUser(alice, () => db.select().from(schema.sleepSessions).where(eq(schema.sleepSessions.ownerEmail, alice.userEmail)));
    expect(sleep?.durationS).toBe(7.5 * 3600);
    expect(sleep?.stages?.[0]?.stage).toBe("deep");
  });

  it("encrypts sensitive columns at rest", async () => {
    const rows = (await getDbExec().execute("SELECT stages FROM sleep_sessions LIMIT 1")) as unknown as { rows: { stages: string }[] };
    expect(rows.rows[0]?.stages.startsWith("enc:v1:")).toBe(true);
    const raw = (await getDbExec().execute("SELECT raw FROM ingest_batches LIMIT 1")) as unknown as { rows: { raw: string }[] };
    expect(raw.rows[0]?.raw.startsWith("enc:v1:")).toBe(true);
  });

  it("is idempotent per batch id", async () => {
    const b = batch({ daily: [{ externalId: "d2", date: "2026-09-29", metric: "steps", value: 5000, unit: "count" }] });
    await ingestBatch({ identity: alice, entitlements: FREE, batch: b });
    const again = await ingestBatch({ identity: alice, entitlements: FREE, batch: b });
    expect(again.duplicate).toBe(true);
  });

  it("upserts re-sent values instead of duplicating them", async () => {
    const day = { externalId: "d3", date: "2026-09-28", metric: "steps", unit: "count" };
    await ingestBatch({ identity: alice, entitlements: FREE, batch: batch({ daily: [{ ...day, value: 100 }] }) });
    await ingestBatch({ identity: alice, entitlements: FREE, batch: batch({ daily: [{ ...day, value: 7000 }] }) });
    const rows = await getDb()
      .select()
      .from(schema.dailyMetrics)
      .where(and(eq(schema.dailyMetrics.ownerEmail, alice.userEmail), eq(schema.dailyMetrics.day, "2026-09-28")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(7000);
  });

  it("drops intraday series for the free tier and keeps them for premium", async () => {
    const series = [{ metric: "heart_rate", unit: "bpm", start: "2026-09-30T00:00:00+02:00", intervalSec: 60, values: [55, 56, null, 58] }];
    const free = await ingestBatch({ identity: bob, entitlements: FREE, batch: batch({ intraday: series }) });
    expect(free.stored.intraday).toBe(0);
    expect(free.skipped.intraday).toBe(1);

    const premium = await ingestBatch({ identity: bob, entitlements: PREMIUM, batch: batch({ intraday: series }) });
    expect(premium.stored.intraday).toBe(1);
    const [row] = await getDb().select().from(schema.intradaySeries).where(eq(schema.intradaySeries.ownerEmail, bob.userEmail));
    expect(row).toMatchObject({ day: "2026-09-30", intervalS: 60, values: "[55,56,null,58]" });
    expect(row?.startAt.toISOString()).toBe("2026-09-29T22:00:00.000Z");
  });

  it("rejects dev sources unless explicitly allowed", async () => {
    const devBatch = batch({ source: { provider: "garmin", via: "gccli-dev" } });
    await expect(ingestBatch({ identity: alice, entitlements: FREE, batch: devBatch })).rejects.toThrow(/dev source/i);
    const ok = await ingestBatch({ identity: alice, entitlements: FREE, batch: devBatch, allowDevSources: true });
    expect(ok.duplicate).toBe(false);
  });

  it("applies deletions for the same source only", async () => {
    await ingestBatch({ identity: alice, entitlements: FREE, batch: batch({ workouts: [{ externalId: "w-del", type: "run", start: "2026-09-27T07:00:00Z", end: "2026-09-27T08:00:00Z" }] }) });
    await ingestBatch({ identity: alice, entitlements: FREE, batch: batch({ deleted: [{ kind: "workout", externalId: "w-del" }] }) });
    const rows = await getDb()
      .select()
      .from(schema.workouts)
      .where(and(eq(schema.workouts.ownerEmail, alice.userEmail), eq(schema.workouts.externalId, "w-del")));
    expect(rows).toHaveLength(0);
  });

  it("creates one health source per device, provider and channel", async () => {
    const sources = await getDb().select().from(schema.healthSources).where(eq(schema.healthSources.ownerEmail, alice.userEmail));
    const keys = sources.map((s) => `${s.provider}/${s.via}`).sort();
    expect(keys).toEqual(["garmin/companion", "garmin/gccli-dev"]);
    expect(sources.every((s) => s.lastSyncAt)).toBe(true);
  });

  it("re-pairing the same phone reuses its source, so re-sent records do not duplicate", async () => {
    const workout = { externalId: "hc-run-1", type: "running", start: "2026-09-27T06:00:00Z", end: "2026-09-27T06:30:00Z" };
    const first = await pairDevice("carol@example.com", "org-c");
    await ingestBatch({ identity: first, entitlements: FREE, batch: batch({ workouts: [workout], daily: [{ externalId: "s", date: "2026-09-27", metric: "steps", value: 100, unit: "count" }] }) });
    const again = await pairDevice("carol@example.com", "org-c");
    expect(again.deviceId).not.toBe(first.deviceId);
    await ingestBatch({ identity: again, entitlements: FREE, batch: batch({ workouts: [workout], daily: [{ externalId: "s", date: "2026-09-27", metric: "steps", value: 120, unit: "count" }] }) });

    const sources = await getDb().select().from(schema.healthSources).where(eq(schema.healthSources.ownerEmail, "carol@example.com"));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.deviceTokenId).toBe(again.deviceId);
    expect(sources[0]!.status).toBe("active");
    const workouts = await getDb().select().from(schema.workouts).where(eq(schema.workouts.ownerEmail, "carol@example.com"));
    expect(workouts).toHaveLength(1);
    const steps = await getDb().select().from(schema.dailyMetrics).where(eq(schema.dailyMetrics.ownerEmail, "carol@example.com"));
    expect(steps.map((r) => r.value)).toEqual([120]);
  });

  it("merges the duplicate sources older databases hold (migration 16)", async () => {
    const owner = { ownerEmail: "dave@example.com", orgId: "org-d", visibility: "private" as const };
    const old = { id: randomUUID(), provider: "health_connect", via: "companion", deviceTokenId: "tok-old", createdAt: "2026-10-10T08:00:00Z", lastSyncAt: "2026-10-10T08:30:00Z", ...owner };
    const latest = { id: randomUUID(), provider: "health_connect", via: "companion", deviceTokenId: "tok-new", createdAt: "2026-10-10T18:00:00Z", lastSyncAt: "2026-10-10T19:00:00Z", ...owner };
    // The unique index from migration 16 already exists in the test DB; insert the pre-migration shape around it.
    await getDbExec().execute("DROP INDEX health_sources_provider_uq");
    await getDb().insert(schema.healthSources).values([old, latest]);
    const w = (sourceId: string, externalId: string) => ({ id: randomUUID(), sourceId, externalId, type: "rowing", startAt: new Date("2026-09-28T10:00:00Z"), endAt: new Date("2026-09-28T10:30:00Z"), updatedAt: "x", ...owner });
    await getDb().insert(schema.workouts).values([w(old.id, "same"), w(latest.id, "same"), w(old.id, "only-old")]);
    await getDb().insert(schema.dailyMetrics).values([
      { sourceId: old.id, day: "2026-10-01", metric: "steps", value: 1, unit: "count", updatedAt: "x", ...owner },
      { sourceId: latest.id, day: "2026-10-01", metric: "steps", value: 2, unit: "count", updatedAt: "x", ...owner },
      { sourceId: old.id, day: "2026-09-30", metric: "steps", value: 3, unit: "count", updatedAt: "x", ...owner },
    ]);

    const { MERGE_DUPLICATE_SOURCES_STATEMENTS } = await import("../../db/merge-sources");
    for (const statement of MERGE_DUPLICATE_SOURCES_STATEMENTS) await getDbExec().execute(statement);
    await getDbExec().execute("CREATE UNIQUE INDEX health_sources_provider_uq ON health_sources (owner_email, provider, via)");

    const sources = await getDb().select().from(schema.healthSources).where(eq(schema.healthSources.ownerEmail, owner.ownerEmail));
    expect(sources.map((s) => s.id)).toEqual([latest.id]);
    const workouts = await getDb().select().from(schema.workouts).where(eq(schema.workouts.ownerEmail, owner.ownerEmail));
    expect(workouts.map((r) => [r.sourceId, r.externalId]).sort()).toEqual([[latest.id, "only-old"], [latest.id, "same"]]);
    const steps = await getDb().select().from(schema.dailyMetrics).where(eq(schema.dailyMetrics.ownerEmail, owner.ownerEmail));
    expect(steps.map((r) => [r.day, r.value]).sort()).toEqual([["2026-09-30", 3], ["2026-10-01", 2]]);
  });

  it("accepts a batch that repeats a natural key (last value wins)", async () => {
    const day = { date: "2026-09-26", metric: "steps", unit: "count" };
    const result = await ingestBatch({
      identity: alice,
      entitlements: FREE,
      batch: batch({ daily: [{ ...day, externalId: "a", value: 1 }, { ...day, externalId: "b", value: 2 }] }),
    });
    expect(result.stored.daily).toBe(1);
    const [row] = await getDb()
      .select()
      .from(schema.dailyMetrics)
      .where(and(eq(schema.dailyMetrics.ownerEmail, alice.userEmail), eq(schema.dailyMetrics.day, "2026-09-26")));
    expect(row?.value).toBe(2);
  });

  it("purges expired raw archives", async () => {
    await getDbExec().execute("UPDATE ingest_batches SET raw_expires_at = '2000-01-01T00:00:00.000Z' WHERE owner_email = 'bob@example.com'");
    const purged = await purgeExpiredArchives({ ownerEmail: bob.userEmail });
    expect(purged).toBeGreaterThan(0);
    const rows = (await getDbExec().execute("SELECT count(*)::int AS n FROM ingest_batches WHERE owner_email = 'bob@example.com' AND raw IS NOT NULL")) as unknown as { rows: { n: number }[] };
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("never writes one user's data under another user", async () => {
    const bobRows = await getDb().select().from(schema.dailyMetrics).where(eq(schema.dailyMetrics.ownerEmail, bob.userEmail));
    expect(bobRows).toHaveLength(0);
  });
});
