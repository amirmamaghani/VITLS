import { randomUUID } from "node:crypto";

import { ingestBatchSchema, type IngestBatchInput } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { authenticateDeviceToken, createPairing, redeemPairing } from "../ingest/devices";
import { ingestBatch } from "../ingest/ingest";
import { logMeal } from "../meals/meals";
import { getHealth } from "./read";

const owner = { userEmail: "hana@example.com", orgId: "org_hana" };
const FREE = { intraday: false, rawRetentionDays: 30 };

async function send(provider: "garmin" | "apple_health", part: Partial<IngestBatchInput>) {
  const { code } = await createPairing(owner);
  const { token } = await redeemPairing(code, { platform: "ios" });
  const identity = (await authenticateDeviceToken(token))!;
  const batch = ingestBatchSchema.parse({ batchId: randomUUID(), sentAt: "2026-09-30T06:00:00Z", source: { provider, via: "companion" }, ...part });
  await ingestBatch({ identity, batch, entitlements: FREE });
}

const day = (i: number) => new Date(Date.parse("2026-09-01") + i * 86_400_000).toISOString().slice(0, 10);

describe("getHealth", () => {
  beforeAll(async () => {
    await setupTestDb();
    await send("garmin", {
      daily: Array.from({ length: 30 }, (_, i) => ({ externalId: `s${i}`, date: day(i), metric: "steps", value: 8000 + i, unit: "count" })),
      points: [
        { externalId: "w1", at: "2026-09-28T06:00:00Z", metric: "weight", value: 82, unit: "kg" },
        { externalId: "w2", at: "2026-09-29T06:00:00Z", metric: "weight", value: 84, unit: "kg" },
      ],
      sleep: [{ externalId: "sl1", start: "2026-09-28T22:00:00Z", end: "2026-09-29T06:00:00Z", stages: [{ stage: "deep", start: "2026-09-28T23:00:00Z", end: "2026-09-29T00:00:00Z" }] }],
      workouts: [
        { externalId: "wo1", type: "running", start: "2026-09-29T17:00:00Z", end: "2026-09-29T17:45:00Z", distanceM: 7500 },
        { externalId: "wo3", type: "strength_training", start: "2026-09-28T17:00:00Z", end: "2026-09-28T18:00:00Z", sets: [{ exercise: "bench_press", reps: 8, weightKg: 80 }, { exercise: "zzz_unknown_move", reps: 5 }] },
        { externalId: "wo2", type: "Pool_Swimming", start: "2026-09-29T07:00:00Z", end: "2026-09-29T07:40:00Z", distanceM: 1500, poolLengthM: 25, strokes: 640 },
      ],
    });
    // A second source reporting the same metric/day must not double count.
    await send("apple_health", { daily: [{ externalId: "a1", date: day(29), metric: "steps", value: 1, unit: "count" }] });
    // The same phone paired again is a new source that re-sends the same sessions.
    await send("garmin", {
      sleep: [{ externalId: "sl1", start: "2026-09-28T22:00:00Z", end: "2026-09-29T06:00:00Z", stages: [{ stage: "deep", start: "2026-09-28T23:00:00Z", end: "2026-09-29T00:00:00Z" }] }],
      workouts: [{ externalId: "wo1", type: "running", start: "2026-09-29T17:00:00Z", end: "2026-09-29T17:45:00Z", distanceM: 7500 }],
    });
  });

  it("collapses a session reported by two pairings of the same device", async () => {
    const h = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["sleep", "workouts"] });
    expect(h.sleep).toEqual([expect.objectContaining({ stageMinutes: { deep: 60 } })]);
    expect((h.workouts as { type: string }[]).filter((w) => w.type === "running")).toHaveLength(1);
  });

  it("returns one source-resolved value per day with a physiology summary", async () => {
    const h = await getHealth(owner.userEmail, { from: day(0), to: day(29), include: ["daily"] });
    const steps = h.daily!.steps!;
    expect(steps.values).toHaveLength(30);
    expect(steps.values[steps.values.length - 1]).toEqual({ date: day(29), value: 8029, source: "garmin" });
    expect(steps.summary.latest).toBe(8029);
  });

  it("explains overnight weight jumps", async () => {
    const h = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["points"] });
    expect(h.points!.weight!.lastChange).toMatchObject({ deltaKg: 2, check: { plausibleAsFat: false, kcalRequired: 15400 } });
  });

  it("returns swim fields and filters workouts by type substring", async () => {
    const all = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["workouts"] });
    expect(all.workouts).toHaveLength(3);
    const swims = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["workouts"], workoutTypes: ["SWIM"] });
    expect(swims.workouts).toHaveLength(1);
    expect(swims.workouts![0]).toMatchObject({ type: "pool_swimming", poolLengthM: 25, strokes: 640 });
    const both = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["workouts"], workoutTypes: ["swim", "run"] });
    expect(both.workouts).toHaveLength(2);
  });

  it("resolves each set's muscle from the exercise library (unmatched sets have none)", async () => {
    const h = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["workouts"], workoutTypes: ["strength"] });
    const sets = (h.workouts![0] as { sets: { exercise: string; muscle?: string }[] }).sets;
    expect(sets[0]).toMatchObject({ exercise: "bench_press", muscle: "pectorals" });
    expect(sets[1]!.muscle).toBeUndefined();
  });

  it("returns sleep with stage minutes and workouts", async () => {
    const h = await getHealth(owner.userEmail, { from: "2026-09-27", to: "2026-09-30", include: ["sleep", "workouts"], workoutTypes: ["running"] });
    expect(h.sleep![0]).toMatchObject({ durationMin: 480, stageMinutes: { deep: 60 } });
    expect(h.workouts![0]).toMatchObject({ type: "running", durationMin: 45, distanceM: 7500 });
  });

  it("filters metrics and never returns other users' data", async () => {
    const h = await getHealth("someone@else.com", { from: day(0), to: day(29), include: ["daily", "points"] });
    expect(h.daily).toEqual({});
    expect(h.points).toEqual({});
  });

  it("aggregates per week using the metric's catalog rule", async () => {
    const h = await getHealth(owner.userEmail, { from: "2026-09-07", to: "2026-09-20", include: ["daily"], bucket: "week" });
    const weeks = h.daily!.steps!.buckets!;
    // 2026-09-07 is a Monday; steps are summed.
    expect(weeks[0]).toEqual({ date: "2026-09-07", value: Array.from({ length: 7 }, (_, i) => 8006 + i).reduce((a, b) => a + b, 0), days: 7 });
    expect(weeks).toHaveLength(2);
  });

  it("caps day-level daily reads at 92 days and everything else at a year", async () => {
    await expect(getHealth(owner.userEmail, { from: "2026-01-01", to: "2026-09-30" })).rejects.toThrow(/92 days/);
    await expect(getHealth(owner.userEmail, { from: "2025-09-01", to: "2026-09-30", include: ["daily"], bucket: "week" })).rejects.toThrow(/366 days/);
    const weekly = await getHealth(owner.userEmail, { from: "2025-10-01", to: "2026-09-30", include: ["daily"], bucket: "week" });
    expect(weekly.daily!.steps!.buckets!.length).toBeGreaterThan(0);
    const points = await getHealth(owner.userEmail, { from: "2025-10-01", to: "2026-09-30", include: ["points", "sleep", "workouts"] });
    expect(points.points!.weight!.values).toHaveLength(2);
  });
  it("returns the owner's meals only when asked, and omits them by default", async () => {
    await logMeal({ userEmail: "reader@example.com", orgId: null }, { eatenAt: "2026-09-20T12:00:00Z", items: [{ name: "Skyr", amount: 150, unit: "g", nutrients: { protein: 16 } }] });
    const h = await getHealth("reader@example.com", { from: "2026-09-20", to: "2026-09-20", include: ["meals"] });
    expect(h.meals).toHaveLength(1);
    expect(h.meals![0]).toMatchObject({ localDate: "2026-09-20", totals: { protein: 16 } });
    expect(h.daily).toBeUndefined();
    const all = await getHealth("reader@example.com", { from: "2026-09-20", to: "2026-09-20" });
    expect(all).not.toHaveProperty("meals");
    expect(Object.keys(all).sort()).toEqual(["daily", "points", "range", "sleep", "sources", "workouts"]);
  });
});
