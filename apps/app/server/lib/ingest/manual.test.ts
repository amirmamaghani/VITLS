import { randomUUID } from "node:crypto";

import { ingestBatchSchema } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { getHealth } from "../health/read";
import { setupTestDb } from "../../test/db";
import { authenticateDeviceToken, createPairing, redeemPairing } from "./devices";
import { ingestBatch } from "./ingest";
import { logManual } from "./manual";

const owner = { userEmail: "mia@example.com", orgId: "org_mia" };
const FREE = { intraday: false, rawRetentionDays: 30 };

describe("manual entry", () => {
  beforeAll(setupTestDb);

  it("stores measurements with unit conversion", async () => {
    await logManual(owner, { entries: [{ metric: "weight", value: 194, unit: "lb", when: "2026-09-29T07:00:00+02:00" }] });
    const h = await getHealth(owner.userEmail, { from: "2026-09-29", to: "2026-09-29", include: ["points"] });
    expect(h.points!.weight!.values[0]).toMatchObject({ source: "manual" });
    expect(h.points!.weight!.values[0]!.value).toBeCloseTo(88, 0);
  });

  it("replaces the same day's manual daily value", async () => {
    await logManual(owner, { entries: [{ metric: "steps", value: 5000, when: "2026-09-28" }] });
    await logManual(owner, { entries: [{ metric: "steps", value: 6500, when: "2026-09-28" }] });
    const h = await getHealth(owner.userEmail, { from: "2026-09-28", to: "2026-09-28", include: ["daily"] });
    expect(h.daily!.steps!.values).toEqual([{ date: "2026-09-28", value: 6500, source: "manual" }]);
  });

  it("is the fallback: a tracker value for the same day wins", async () => {
    const { code } = await createPairing(owner);
    const identity = (await authenticateDeviceToken((await redeemPairing(code, { platform: "ios" })).token))!;
    await ingestBatch({
      identity,
      entitlements: FREE,
      batch: ingestBatchSchema.parse({
        batchId: randomUUID(),
        sentAt: "2026-09-30T06:00:00Z",
        source: { provider: "garmin", via: "companion" },
        daily: [{ externalId: "g1", date: "2026-09-28", metric: "steps", value: 9100, unit: "count" }],
      }),
    });
    const h = await getHealth(owner.userEmail, { from: "2026-09-28", to: "2026-09-28", include: ["daily"] });
    expect(h.daily!.steps!.values[0]).toMatchObject({ value: 9100, source: "garmin" });
  });

  it("logs workouts", async () => {
    await logManual(owner, { workouts: [{ type: "strength_training", start: "2026-09-29T17:00:00+02:00", durationMin: 60 }] });
    const h = await getHealth(owner.userEmail, { from: "2026-09-29", to: "2026-09-29", include: ["workouts"] });
    expect(h.workouts![0]).toMatchObject({ type: "strength_training", durationMin: 60, source: "manual" });
  });

  it("rejects intraday metrics and devices that claim to be manual", async () => {
    await expect(logManual(owner, { entries: [{ metric: "heart_rate", value: 60, when: "2026-09-29" }] })).rejects.toThrow(/manually/);
    const { code } = await createPairing(owner);
    const identity = (await authenticateDeviceToken((await redeemPairing(code, { platform: "ios" })).token))!;
    const forged = ingestBatchSchema.parse({ batchId: randomUUID(), sentAt: "2026-09-30T06:00:00Z", source: { provider: "manual", via: "manual" } });
    await expect(ingestBatch({ identity, entitlements: FREE, batch: forged })).rejects.toThrow(/signed-in user/);
  });
});
