import { randomUUID } from "node:crypto";

import { ingestBatchSchema, type IngestBatchInput } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { authenticateDeviceToken, createPairing, redeemPairing } from "../ingest/devices";
import { ingestBatch } from "../ingest/ingest";
import { getDataCatalog } from "./catalog";

const owner = { userEmail: "ivo@example.com", orgId: "org_ivo" };
const FREE = { intraday: false, rawRetentionDays: 30 };

async function send(provider: "garmin" | "apple_health", part: Partial<IngestBatchInput>) {
  const { code } = await createPairing(owner);
  const { token } = await redeemPairing(code, { platform: "ios" });
  const identity = (await authenticateDeviceToken(token))!;
  const batch = ingestBatchSchema.parse({ batchId: randomUUID(), sentAt: "2026-09-30T06:00:00Z", source: { provider, via: "companion" }, ...part });
  await ingestBatch({ identity, batch, entitlements: FREE });
}

describe("getDataCatalog", () => {
  beforeAll(async () => {
    await setupTestDb();
    await send("garmin", {
      daily: [
        { externalId: "s1", date: "2026-09-01", metric: "steps", value: 8000, unit: "count" },
        { externalId: "s2", date: "2026-09-02", metric: "steps", value: 8100, unit: "count" },
      ],
      points: [{ externalId: "w1", at: "2026-09-02T06:00:00Z", metric: "weight", value: 82, unit: "kg" }],
      sleep: [{ externalId: "sl1", start: "2026-09-01T22:00:00Z", end: "2026-09-02T06:00:00Z", stages: [] }],
    });
    await send("apple_health", { daily: [{ externalId: "a1", date: "2026-09-02", metric: "steps", value: 7900, unit: "count" }] });
  });

  it("counts rows per source, metric and section with first and last day", async () => {
    const c = await getDataCatalog(owner.userEmail);
    expect(c.sources.map((s) => [s.provider, s.rows]).sort()).toEqual([["apple_health", 1], ["garmin", 4]]);
    expect(c.metrics.find((m) => m.key === "steps")).toMatchObject({ kind: "daily", unit: "count", rows: 3, firstDay: "2026-09-01", lastDay: "2026-09-02" });
    expect(c.metrics.find((m) => m.key === "weight")).toMatchObject({ kind: "point", rows: 1, firstDay: "2026-09-02", lastDay: "2026-09-02" });
    expect(c.metrics.find((m) => m.key === "floors")).toMatchObject({ rows: 0, firstDay: null, lastDay: null });
    expect(c.sections.sleep).toMatchObject({ rows: 1, firstDay: "2026-09-01", lastDay: "2026-09-02" });
    expect(c.sections.workouts).toEqual({ rows: 0, firstDay: null, lastDay: null });
  });

  it("is empty for a user without sources", async () => {
    const c = await getDataCatalog("nobody@example.com");
    expect(c.sources).toEqual([]);
    expect(c.metrics.every((m) => m.rows === 0)).toBe(true);
  });
});
