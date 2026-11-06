/**
 * Batch ingest: validated, canonical-unit batches from a paired device → org/user-scoped tables.
 * Idempotent per batch id, upserts per natural key, tier-aware for intraday data.
 * See docs/design/02-data-model-and-ingest.md §3–§5.
 */
import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { normalizeBatch, type IngestBatch } from "@vitls/health-ingest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";
import type { DeviceIdentity } from "./devices";

export interface Entitlements {
  /** Store premium intraday series. */
  intraday: boolean;
  /** How long the encrypted raw batch is kept for re-processing. */
  rawRetentionDays: number;
}

export interface IngestResult {
  batchId: string;
  duplicate: boolean;
  sourceId: string;
  stored: { daily: number; points: number; intraday: number; sleep: number; workouts: number; deleted: number };
  skipped: { intraday: number };
}

const CHUNK = 500;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function ingestBatch(input: {
  identity: DeviceIdentity;
  batch: IngestBatch;
  entitlements: Entitlements;
  allowDevSources?: boolean;
  /** True only for session-authenticated manual entry (log-health-data); devices can never claim "manual". */
  manual?: boolean;
}): Promise<IngestResult> {
  const { identity, entitlements } = input;
  if (input.batch.source.via === "gccli-dev" && !input.allowDevSources) {
    fail("Dev sources are disabled on this server", { statusCode: 403, errorCode: "dev_source_disabled" });
  }
  const claimsManual = input.batch.source.via === "manual" || input.batch.source.provider === "manual";
  if (claimsManual !== Boolean(input.manual)) {
    fail("Manual entries are only accepted from the signed-in user", { statusCode: 403, errorCode: "manual_source_forbidden" });
  }
  const batch = dedupeBatch(normalizeBatch(input.batch));
  const owner = { ownerEmail: identity.userEmail, orgId: identity.orgId, visibility: "private" as const };

  return runWithRequestContext({ userEmail: identity.userEmail, orgId: identity.orgId ?? undefined }, async () => {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const sourceId = await resolveSource(db, identity, batch, nowIso);
    const stored = { daily: 0, points: 0, intraday: 0, sleep: 0, workouts: 0, deleted: 0 };
    const skipped = { intraday: entitlements.intraday ? 0 : batch.intraday.length };

    const duplicate = await db.transaction(async (tx) => {
      const ledger = await tx
        .insert(schema.ingestBatches)
        .values({
          id: randomUUID(),
          batchId: batch.batchId,
          sourceId,
          receivedAt: nowIso,
          counts: "{}",
          raw: batch,
          rawExpiresAt: new Date(now.getTime() + entitlements.rawRetentionDays * 86_400_000).toISOString(),
          ...owner,
        })
        .onConflictDoNothing()
        .returning({ id: schema.ingestBatches.id });
      if (ledger.length === 0) return true;

      stored.daily = await upsertDaily(tx, batch, sourceId, owner, nowIso);
      stored.points = await upsertPoints(tx, batch, sourceId, owner, nowIso);
      stored.sleep = await upsertSleep(tx, batch, sourceId, owner, nowIso);
      stored.workouts = await upsertWorkouts(tx, batch, sourceId, owner, nowIso);
      if (entitlements.intraday) stored.intraday = await upsertIntraday(tx, batch, sourceId, owner, nowIso);
      stored.deleted = await applyDeletions(tx, batch, sourceId, identity.userEmail);

      await tx
        .update(schema.ingestBatches)
        .set({ counts: JSON.stringify({ stored, skipped }) })
        .where(and(eq(schema.ingestBatches.id, ledger[0]!.id), eq(schema.ingestBatches.ownerEmail, identity.userEmail)));
      return false;
    });

    await db
      .update(schema.healthSources)
      .set({ lastSyncAt: nowIso })
      .where(and(eq(schema.healthSources.id, sourceId), eq(schema.healthSources.ownerEmail, identity.userEmail)));

    return { batchId: batch.batchId, duplicate, sourceId, stored, skipped };
  }) as Promise<IngestResult>;
}

/** Keeps the last item per natural key so one batch never upserts the same row twice (Postgres rejects that). */
const lastBy = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];

function dedupeBatch(batch: IngestBatch): IngestBatch {
  return {
    ...batch,
    daily: lastBy(batch.daily, (d) => `${d.date}|${d.metric}`),
    points: lastBy(batch.points, (p) => p.externalId),
    sleep: lastBy(batch.sleep, (s) => s.externalId),
    workouts: lastBy(batch.workouts, (w) => w.externalId),
    intraday: lastBy(batch.intraday, (s) => `${s.metric}|${Date.parse(s.start)}`),
  };
}

/** One source per user, provider and channel: a re-paired phone keeps feeding the same source under its new token. */
async function resolveSource(db: Db, identity: DeviceIdentity, batch: IngestBatch, nowIso: string): Promise<string> {
  const { provider, via, device } = batch.source;
  const t = schema.healthSources;
  const key = and(eq(t.ownerEmail, identity.userEmail), eq(t.provider, provider), eq(t.via, via));
  await db
    .insert(t)
    .values({
      id: randomUUID(),
      provider,
      via,
      deviceTokenId: identity.deviceId,
      label: device ?? null,
      createdAt: nowIso,
      ownerEmail: identity.userEmail,
      orgId: identity.orgId,
    })
    .onConflictDoNothing();
  const [source] = await db
    .update(t)
    .set({ deviceTokenId: identity.deviceId, status: "active", ...(device ? { label: device } : {}) })
    .where(key)
    .returning({ id: t.id });
  return source!.id;
}

type Owner = { ownerEmail: string; orgId: string | null; visibility: "private" };

async function upsertDaily(tx: Tx, batch: IngestBatch, sourceId: string, owner: Owner, nowIso: string) {
  const t = schema.dailyMetrics;
  for (const rows of chunks(batch.daily)) {
    await tx
      .insert(t)
      .values(rows.map((d) => ({ sourceId, day: d.date, metric: d.metric, value: d.value, unit: d.unit, externalId: d.externalId, updatedAt: nowIso, ...owner })))
      .onConflictDoUpdate({
        target: [t.ownerEmail, t.sourceId, t.metric, t.day],
        set: { value: excluded("value"), unit: excluded("unit"), externalId: excluded("external_id"), updatedAt: excluded("updated_at") },
      });
  }
  return batch.daily.length;
}

async function upsertPoints(tx: Tx, batch: IngestBatch, sourceId: string, owner: Owner, nowIso: string) {
  const t = schema.pointMetrics;
  for (const rows of chunks(batch.points)) {
    await tx
      .insert(t)
      .values(rows.map((p) => ({ sourceId, externalId: p.externalId, at: new Date(p.at), zoneOffset: p.zoneOffset ?? null, metric: p.metric, value: p.value, unit: p.unit, updatedAt: nowIso, ...owner })))
      .onConflictDoUpdate({
        target: [t.ownerEmail, t.sourceId, t.externalId, t.at],
        set: { zoneOffset: excluded("zone_offset"), metric: excluded("metric"), value: excluded("value"), unit: excluded("unit"), updatedAt: excluded("updated_at") },
      });
  }
  return batch.points.length;
}

async function upsertSleep(tx: Tx, batch: IngestBatch, sourceId: string, owner: Owner, nowIso: string) {
  const t = schema.sleepSessions;
  for (const rows of chunks(batch.sleep)) {
    await tx
      .insert(t)
      .values(
        rows.map((s) => {
          const startAt = new Date(s.start);
          const endAt = new Date(s.end);
          return { id: randomUUID(), sourceId, externalId: s.externalId, startAt, endAt, durationS: Math.round((endAt.getTime() - startAt.getTime()) / 1000), stages: s.stages, scores: s.scores ? JSON.stringify(s.scores) : null, updatedAt: nowIso, ...owner };
        }),
      )
      .onConflictDoUpdate({
        target: [t.ownerEmail, t.sourceId, t.externalId],
        set: { startAt: excluded("start_at"), endAt: excluded("end_at"), durationS: excluded("duration_s"), stages: excluded("stages"), scores: excluded("scores"), updatedAt: excluded("updated_at") },
      });
  }
  return batch.sleep.length;
}

async function upsertWorkouts(tx: Tx, batch: IngestBatch, sourceId: string, owner: Owner, nowIso: string) {
  const t = schema.workouts;
  for (const rows of chunks(batch.workouts)) {
    await tx
      .insert(t)
      .values(
        rows.map((w) => ({
          id: randomUUID(),
          sourceId,
          externalId: w.externalId,
          type: w.type,
          startAt: new Date(w.start),
          endAt: new Date(w.end),
          distanceM: w.distanceM ?? null,
          energyKcal: w.energyKcal ?? null,
          avgHr: w.avgHr ?? null,
          maxHr: w.maxHr ?? null,
          poolLengthM: w.poolLengthM ?? null,
          strokes: w.strokes ?? null,
          zones: w.zones ? JSON.stringify(w.zones) : null,
          sets: w.sets ?? null,
          updatedAt: nowIso,
          ...owner,
        })),
      )
      .onConflictDoUpdate({
        target: [t.ownerEmail, t.sourceId, t.externalId],
        set: {
          type: excluded("type"),
          startAt: excluded("start_at"),
          endAt: excluded("end_at"),
          distanceM: excluded("distance_m"),
          energyKcal: excluded("energy_kcal"),
          avgHr: excluded("avg_hr"),
          maxHr: excluded("max_hr"),
          poolLengthM: excluded("pool_length_m"),
          strokes: excluded("strokes"),
          zones: excluded("zones"),
          sets: excluded("sets"),
          updatedAt: excluded("updated_at"),
        },
      });
  }
  return batch.workouts.length;
}

async function upsertIntraday(tx: Tx, batch: IngestBatch, sourceId: string, owner: Owner, nowIso: string) {
  const t = schema.intradaySeries;
  for (const rows of chunks(batch.intraday)) {
    await tx
      .insert(t)
      .values(
        rows.map((s) => ({
          sourceId,
          metric: s.metric,
          // The device-local calendar day, taken from the offset-bearing timestamp it sent.
          day: s.start.slice(0, 10),
          startAt: new Date(s.start),
          intervalS: s.intervalSec,
          values: JSON.stringify(s.values),
          updatedAt: nowIso,
          ...owner,
        })),
      )
      .onConflictDoUpdate({
        target: [t.ownerEmail, t.sourceId, t.metric, t.startAt],
        set: { day: excluded("day"), intervalS: excluded("interval_s"), values: excluded("values"), updatedAt: excluded("updated_at") },
      });
  }
  return batch.intraday.length;
}

async function applyDeletions(tx: Tx, batch: IngestBatch, sourceId: string, ownerEmail: string) {
  const tables = {
    daily: schema.dailyMetrics,
    point: schema.pointMetrics,
    sleep: schema.sleepSessions,
    workout: schema.workouts,
  } as const;
  let deleted = 0;
  for (const kind of Object.keys(tables) as (keyof typeof tables)[]) {
    const ids = batch.deleted.filter((d) => d.kind === kind).map((d) => d.externalId);
    if (ids.length === 0) continue;
    const t = tables[kind];
    const removed = await tx
      .delete(t)
      .where(and(eq(t.ownerEmail, ownerEmail), eq(t.sourceId, sourceId), inArray(t.externalId, ids)))
      .returning({ sourceId: t.sourceId });
    deleted += removed.length;
  }
  return deleted;
}
