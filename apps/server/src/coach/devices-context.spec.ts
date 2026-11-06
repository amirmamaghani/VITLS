import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { dailyMetrics, deviceTokens, ingestBatches } from "../db/schema";
import { devicesContext } from "./devices-context";

describe("devicesContext", () => {
  const dbs = new DbService();
  const run = Date.now();
  const empty = `dctx-empty-${run}@t.co`;
  const full = `dctx-full-${run}@t.co`;

  afterAll(async () => {
    for (const t of [dailyMetrics, ingestBatches, deviceTokens]) await dbs.db.delete(t).where(inArray(t.ownerEmail, [empty, full]));
    await dbs.onModuleDestroy();
  });

  test("nothing paired, no batches: fallbacks and every goal metric missing", async () => {
    expect(await devicesContext(dbs, empty, ["weight"])).toBe(
      [
        "<devices>",
        "paired: no device paired yet — offer the companion app in the data stage",
        "last batch: never",
        "goal metrics with no data in the last 14 days: weight",
        "</devices>",
      ].join("\n"),
    );
  });

  test("paired device, recent batch and recent metric", async () => {
    const now = new Date().toISOString();
    await dbs.db.insert(deviceTokens).values([
      { id: randomUUID(), tokenHash: `h-${randomUUID()}`, tokenPrefix: "vdt_a", platform: "ios", label: "iPhone", createdAt: now, ownerEmail: full },
      { id: randomUUID(), tokenHash: `h-${randomUUID()}`, tokenPrefix: "vdt_b", platform: "android", createdAt: now, revokedAt: now, ownerEmail: full },
    ]);
    await dbs.db.insert(ingestBatches).values({ id: randomUUID(), batchId: randomUUID(), sourceId: "s", receivedAt: now, counts: "{}", ownerEmail: full });
    await dbs.db.insert(dailyMetrics).values({ sourceId: "s", day: now.slice(0, 10), metric: "steps", value: 1, unit: "count", updatedAt: now, ownerEmail: full });
    const out = await devicesContext(dbs, full, ["steps", "weight"]);
    expect(out).toContain("paired: ios (iPhone)\n");
    expect(out).not.toContain("android");
    expect(out).toContain(`last batch: ${now}`);
    expect(out).toContain("no data in the last 14 days: weight\n");
  });
});
