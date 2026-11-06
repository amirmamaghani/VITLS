import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createApp } from "../app.factory";
import { ChatService } from "./chat.service";
import { MemoriesService } from "./memories.service";
import { ReadoutCron } from "./readout.cron";
import { ReadoutService } from "./readout.service";

process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

let app: NestExpressApplication;
beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
});

it("readout/memory providers resolve through the real module graph", () => {
  for (const t of [ReadoutCron, ReadoutService, MemoriesService, ChatService]) expect(app.get(t)).toBeDefined();
});
