import { randomUUID } from "node:crypto";

import { ingestBatchSchema } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";
import { createPairing, redeemPairing } from "./devices";
import { notifyFirstBatch } from "./first-batch";
import { ingestBatch } from "./ingest";

const notified: { title: string; idempotencyKey?: string }[] = [];
let failNext = false;
vi.mock("@agent-native/core/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notify: async (input: { title: string; idempotencyKey?: string }) => {
    if (failNext) {
      failNext = false;
      throw new Error("push provider down");
    }
    notified.push(input);
    return undefined;
  },
}));

const owner = { userEmail: "ben@example.com", orgId: "org_ben" };
const FREE = { intraday: false, rawRetentionDays: 30 };
const batchFor = (days: string[]) =>
  ingestBatchSchema.parse({
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    source: { provider: "health_connect", via: "companion" },
    daily: days.map((date) => ({ externalId: `steps:${date}`, date, metric: "steps", value: 1000, unit: "count" })),
  });

describe("first batch notification", () => {
  beforeAll(setupTestDb);

  it("fires once per source with the number of days, then never again", async () => {
    const { code } = await createPairing(owner);
    const { deviceId } = await redeemPairing(code, { platform: "android" });
    const identity = { ...owner, deviceId, scope: "ingest:write" };

    const first = batchFor(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const r1 = await ingestBatch({ identity, batch: first, entitlements: FREE });
    expect(await notifyFirstBatch(identity, r1, first)).toBe(true);
    expect(notified[0]).toMatchObject({ title: expect.stringContaining("3 days"), idempotencyKey: `first-batch:${r1.sourceId}` });

    const dup = await ingestBatch({ identity, batch: first, entitlements: FREE });
    expect(dup.duplicate).toBe(true);
    expect(await notifyFirstBatch(identity, dup, first)).toBe(false);

    const second = batchFor(["2026-10-04"]);
    const r2 = await ingestBatch({ identity, batch: second, entitlements: FREE });
    expect(await notifyFirstBatch(identity, r2, second)).toBe(false);
    expect(notified).toHaveLength(1);
  });

  it("never throws when notify fails; the batch is still stored and reported as not notified", async () => {
    const otherOwner = { userEmail: "cara@example.com", orgId: "org_cara" };
    const { code } = await createPairing(otherOwner);
    const { deviceId } = await redeemPairing(code, { platform: "ios" });
    const identity = { ...otherOwner, deviceId, scope: "ingest:write" };

    const batch = batchFor(["2026-10-01"]);
    const result = await ingestBatch({ identity, batch, entitlements: FREE });
    failNext = true;
    await expect(notifyFirstBatch(identity, result, batch)).resolves.toBe(false);
    expect(notified.filter((n) => n.idempotencyKey === `first-batch:${result.sourceId}`)).toHaveLength(0);
  });
});
