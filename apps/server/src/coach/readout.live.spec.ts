import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import { dailyMetrics, healthSources, userSettings } from "../db/schema";
import { PushService } from "../devices/push.service";
import { CoachService } from "./coach.service";
import { GOAL_MODULES } from "./coach.schema";
import { hasCoachKey } from "./model";
import { ReadoutService, localDateTime } from "./readout.service";

process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

// Real model, stubbed push: runs only when ANTHROPIC_API_KEY is set.
describe.skipIf(!hasCoachKey())("morning readout live smoke", () => {
  const owner = `readoutlive-${Date.now()}@t.co`;
  const timezone = "Europe/London";
  let app: NestExpressApplication;
  let dbs: DbService;
  let send: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await createApp();
    dbs = app.get(DbService);
    send = vi.spyOn(app.get(PushService), "send").mockResolvedValue({ sent: 0 });
    await app.get(CoachService).updateProfile(owner, { timezone, readoutTime: "07:00", goals: [{ module: Object.keys(GOAL_MODULES)[0] as never, priority: 1, targets: {} }] });
    const now = new Date().toISOString();
    await dbs.db.insert(healthSources).values({ id: `${owner}-src`, provider: "garmin", via: "companion", deviceTokenId: "t", createdAt: now, ownerEmail: owner });
    const days = Array.from({ length: 5 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    await dbs.db.insert(dailyMetrics).values(days.map((day, i) => ({ sourceId: `${owner}-src`, day, metric: "steps", value: 4000 + i * 1500, unit: "count", updatedAt: now, ownerEmail: owner })));
  });

  afterAll(async () => {
    for (const t of [dailyMetrics, healthSources, userSettings]) await dbs.db.delete(t).where(eq(t.ownerEmail, owner));
    await app.close();
  });

  it("generates, saves and pushes a readout", async () => {
    expect(await app.get(ReadoutService).generateFor(owner)).toEqual({ generated: true });
    const readout = await app.get(CoachService).getReadout(owner);
    expect(readout?.date).toBe(localDateTime(new Date(), timezone).date);
    expect(readout?.directive.length).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledWith(owner, expect.objectContaining({ title: expect.any(String), body: expect.any(String) }));
  }, 120_000);
});
