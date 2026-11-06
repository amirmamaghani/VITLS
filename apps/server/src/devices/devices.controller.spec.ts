import type { AddressInfo } from "node:net";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import { devicePairings, deviceTokens } from "../db/schema";
import { DevicesService } from "./devices.service";

// BetterAuth reads these at instance construction (AUTH factory); test values only.
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

let app: NestExpressApplication;
let base: string;
const owner = `ctl-${Date.now()}@t.co`;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  const { db } = app.get(DbService);
  await db.delete(deviceTokens).where(eq(deviceTokens.ownerEmail, owner));
  await db.delete(devicePairings).where(eq(devicePairings.ownerEmail, owner));
  await app.close();
});

test("POST /api/devices/redeem returns a vdt_ token and the frozen ingestUrl", async () => {
  const { code } = await app.get(DevicesService).createPairing(owner);
  const res = await post("/api/devices/redeem", { code, device: { platform: "cli" } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.token).toMatch(/^vdt_/);
  expect(body.deviceId).toBeTruthy();
  expect(body.ingestUrl).toBe("/api/ingest/v1/batches");
});

test("POST /api/devices/redeem with a bad code → 400 invalid_pairing_code (service HttpException mapped by the filter)", async () => {
  const res = await post("/api/devices/redeem", { code: "AAAABBBBCCCC", device: { platform: "cli" } });
  expect(res.status).toBe(400);
  expect((await res.json()).errorCode).toBe("invalid_pairing_code");
});

test("POST /api/devices/redeem with a missing code → 400 invalid_payload (ZodError mapped; JSON body parsed through the full mount)", async () => {
  const res = await post("/api/devices/redeem", { device: { platform: "cli" } });
  expect(res.status).toBe(400);
  expect((await res.json()).errorCode).toBe("invalid_payload");
});

test("POST /api/devices/redeem with a malformed JSON body → 400 invalid_payload", async () => {
  const res = await fetch(`${base}/api/devices/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(res.status).toBe(400);
  expect((await res.json()).errorCode).toBe("invalid_payload");
});

test("POST /api/devices/push without an Authorization header → 401", async () => {
  const res = await post("/api/devices/push", { expoToken: "ExponentPushToken[xxxxxxxx]" });
  expect(res.status).toBe(401);
});
