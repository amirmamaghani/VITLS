import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DbService } from "../common/db/db.service";
import { chatThreads, dailyMetrics, healthSources, userSettings } from "../db/schema";
import { ChatService } from "./chat.service";
import { ChatThreadStore } from "./chat-thread.store";
import { CoachService } from "./coach.service";
import { GOAL_MODULES } from "./coach.schema";
import { hasCoachKey } from "./model";
import { createApp } from "../app.factory";
import type { NestExpressApplication } from "@nestjs/platform-express";

process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

// Real model: runs only when ANTHROPIC_API_KEY is set.
describe.skipIf(!hasCoachKey())("coach chat live smoke", () => {
  const owner = `chatlive-${Date.now()}@t.co`;
  const dashboardId = "live-dash";
  let app: NestExpressApplication;
  let dbs: DbService;
  let threads: ChatThreadStore;

  beforeAll(async () => {
    app = await createApp();
    dbs = app.get(DbService);
    threads = app.get(ChatThreadStore);
    await app.get(CoachService).updateProfile(owner, { timezone: "Europe/London", goals: [{ module: Object.keys(GOAL_MODULES)[0] as never, priority: 1, targets: {} }] });
    const now = new Date().toISOString();
    await dbs.db.insert(healthSources).values({ id: `${owner}-src`, provider: "garmin", via: "companion", deviceTokenId: "t", createdAt: now, ownerEmail: owner });
    const days = Array.from({ length: 5 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    await dbs.db.insert(dailyMetrics).values(days.map((day, i) => ({ sourceId: `${owner}-src`, day, metric: "steps", value: 4000 + i * 1500, unit: "count", updatedAt: now, ownerEmail: owner })));
  });

  afterAll(async () => {
    for (const t of [dailyMetrics, healthSources, chatThreads, userSettings]) await dbs.db.delete(t).where(eq(t.ownerEmail, owner));
    await app.close();
  });

  it("answers from health data via get-health", async () => {
    const msg = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "What's my step count trend this week? One sentence." }] };
    const res = await app.get(ChatService).stream(owner, { dashboardId, messages: [msg] });
    await res.text(); // drain; onFinish persists the thread
    const thread = await (async () => {
      for (let i = 0; i < 20; i++) {
        const t = await threads.load(owner, dashboardId);
        if (t.length > 1) return t;
        await new Promise((r) => setTimeout(r, 250));
      }
      return threads.load(owner, dashboardId);
    })();
    const reply = thread.at(-1)!;
    expect(reply.role).toBe("assistant");
    expect(reply.parts.some((p) => p.type === "text" && p.text.trim().length > 0)).toBe(true);
    expect(reply.parts.some((p) => p.type === "tool-get-health")).toBe(true);
  }, 90_000);
});
