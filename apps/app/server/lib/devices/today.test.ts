import { randomUUID } from "node:crypto";

import { ingestBatchSchema } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { saveReadout } from "../coach/readout";
import { updateCoachProfile } from "../coach/profile";
import { createPairing, redeemPairing } from "../ingest/devices";
import { ingestBatch } from "../ingest/ingest";
import { logManual } from "../ingest/manual";
import { getToday } from "./today";

const owner = { userEmail: "tina@example.com", orgId: "org_tina" };
const FREE = { intraday: false, rawRetentionDays: 30 };
const today = new Date().toISOString().slice(0, 10);

async function pairedIdentity() {
  const { code } = await createPairing(owner);
  const { deviceId } = await redeemPairing(code, { platform: "android" });
  return { ...owner, deviceId, scope: "ingest:write" };
}

describe("today view", () => {
  beforeAll(setupTestDb);

  it("is empty but well-formed for a fresh user", async () => {
    expect(await getToday(owner)).toEqual({ date: today, readout: null, metrics: {}, lastBatchAt: null, missing: [] });
  });

  it("does not count a manual quick log as phone data (lastBatchAt)", async () => {
    const manualOwner = { userEmail: "mo@example.com", orgId: "org_mo" };
    await logManual(manualOwner, { entries: [{ metric: "weight", value: 80, when: today }] });
    expect((await getToday(manualOwner)).lastBatchAt).toBeNull();
  });

  it("returns the readout, today's numbers and goal metrics nobody provides", async () => {
    await updateCoachProfile(owner.userEmail, { timezone: "UTC", goals: [{ module: "endurance", priority: 1, targets: {} }] });
    await saveReadout(owner.userEmail, { date: today, directive: "Easy run.", highlights: [{ metric: "steps", note: "on track" }] });
    const identity = await pairedIdentity();
    await ingestBatch({
      identity,
      batch: ingestBatchSchema.parse({
        batchId: randomUUID(),
        sentAt: new Date().toISOString(),
        source: { provider: "health_connect", via: "companion" },
        daily: [
          { externalId: `steps:${today}`, date: today, metric: "steps", value: 8200, unit: "count" },
          { externalId: `resting_hr:${today}`, date: today, metric: "resting_hr", value: 52, unit: "bpm" },
          { externalId: `distance:${today}`, date: today, metric: "distance", value: 5000, unit: "m" },
          { externalId: `sleep_duration:${today}`, date: today, metric: "sleep_duration", value: 27120, unit: "s" },
        ],
      }),
      entitlements: FREE,
    });
    const view = await getToday(owner);
    expect(view.readout?.directive).toBe("Easy run.");
    expect(view.metrics).toEqual({ steps: 8200, resting_hr: 52, sleep_min: 452 });
    expect(view.lastBatchAt).not.toBeNull();
    // endurance needs vo2max, distance, resting_hr, hrv_rmssd_night; two of them arrived
    expect(view.missing).toEqual(["vo2max", "hrv_rmssd_night"]);
  });
});
