import { randomUUID } from "node:crypto";

import { ingestBatchSchema, type IngestBatchInput } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { authenticateDeviceToken, createPairing, redeemPairing } from "../ingest/devices";
import { ingestBatch } from "../ingest/ingest";
import { logManual } from "../ingest/manual";
import { getHealthRaw } from "./raw";
import { getHealth } from "./read";

const owner = { userEmail: "lea@example.com", orgId: "org_lea" };
const FREE = { intraday: false, rawRetentionDays: 30 };

async function send(provider: "garmin" | "apple_health", part: Partial<IngestBatchInput>) {
  const { code } = await createPairing(owner);
  const { token } = await redeemPairing(code, { platform: "ios" });
  const identity = (await authenticateDeviceToken(token))!;
  const batch = ingestBatchSchema.parse({ batchId: randomUUID(), sentAt: "2026-09-30T06:00:00Z", source: { provider, via: "companion" }, ...part });
  await ingestBatch({ identity, batch, entitlements: FREE });
}
const day = (i: number) => new Date(Date.parse("2026-06-01") + i * 86_400_000).toISOString().slice(0, 10);

describe("getHealthRaw", () => {
  beforeAll(async () => {
    await setupTestDb();
    await send("garmin", { daily: Array.from({ length: 120 }, (_, i) => ({ externalId: `g${i}`, date: day(i), metric: "steps", value: 8000 + i, unit: "count" })) });
    await send("apple_health", { daily: [{ externalId: "a119", date: day(119), metric: "steps", value: 7000, unit: "count" }] });
    await logManual(owner, { entries: [{ metric: "steps", value: 500, unit: "count", when: day(119) }] });
    await send("garmin", { sleep: [{ externalId: "sl1", start: "2026-09-27T22:00:00Z", end: "2026-09-28T06:00:00Z", stages: [{ stage: "deep", start: "2026-09-27T23:00:00Z", end: "2026-09-28T00:00:00Z" }] }] });
  });

  it("returns every source's row for a day and marks the winner", async () => {
    const r = await getHealthRaw(owner, { metric: "steps", before: day(120), days: 1 });
    const rows = r.rows.filter((row) => row.kind === "daily");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row.source.provider, row.winner]).sort()).toEqual([["apple_health", false], ["garmin", true], ["manual", false]]);
    expect(r.sources.map((s) => s.provider).sort()).toEqual(["apple_health", "garmin", "manual"]);
  });

  it("pages backwards in windows and stops at the first record", async () => {
    const first = await getHealthRaw(owner, { metric: "steps", before: day(120), days: 92 });
    expect(first.window).toEqual({ from: day(28), to: day(119) });
    expect(first.rows.filter((row) => row.kind === "daily" && row.winner)).toHaveLength(92);
    expect(first.rows[0]).toMatchObject({ kind: "daily", day: day(119) });
    expect(first.nextBefore).toBe(day(28));
    const second = await getHealthRaw(owner, { metric: "steps", before: first.nextBefore!, days: 92 });
    expect(second.rows).toHaveLength(28);
    expect(second.nextBefore).toBeNull();
    const nothing = await getHealthRaw(owner, { metric: "steps", before: day(0), days: 92 });
    expect(nothing.rows).toEqual([]);
    expect(nothing.nextBefore).toBeNull();
  });

  it("returns sleep sessions with decrypted stages", async () => {
    const r = await getHealthRaw(owner, { section: "sleep", before: "2026-10-01", days: 30 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ kind: "sleep", durationS: 8 * 3600, stages: [{ stage: "deep" }] });
    expect(r.nextBefore).toBeNull();
  });

  it("marks as winner the same row get-health uses when two sources share a provider", async () => {
    // A second garmin source (new pairing) reporting the same day: a provider tie that only the source id can break.
    await send("garmin", { daily: [{ externalId: "g50b", date: day(50), metric: "steps", value: 1, unit: "count" }] });
    const raw = await getHealthRaw(owner, { metric: "steps", before: day(51), days: 1 });
    const winners = raw.rows.filter((row) => row.kind === "daily" && row.winner);
    expect(winners).toHaveLength(1);
    const resolved = await getHealth(owner.userEmail, { from: day(50), to: day(50), include: ["daily"], metrics: ["steps"] });
    expect(resolved.daily!.steps!.values[0]!.value).toBe((winners[0] as { value: number }).value);
  });

  it("rejects unknown metrics and ambiguous queries", async () => {
    await expect(getHealthRaw(owner, { metric: "nonsense" })).rejects.toThrow(/unknown metric/i);
    await expect(getHealthRaw(owner, { metric: "steps", section: "sleep" })).rejects.toThrow(/one of/i);
    await expect(getHealthRaw(owner, {})).rejects.toThrow(/one of/i);
  });
});
