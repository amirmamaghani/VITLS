import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import {
  dailyMetrics,
  deviceTokens,
  devicePairings,
  healthSources,
  ingestBatches,
  pointMetrics,
  rateLimits,
  sleepSessions,
  workouts,
} from "../db/schema";
import { DevicesService } from "../devices/devices.service";

// Read at module construction by the field-crypto + BetterAuth factories; test values only.
process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

let app: NestExpressApplication;
let base: string;
let token: string;
let deviceId: string;
const owner = `ingest-${Date.now()}@t.co`;

/** A minimal batch that satisfies ingestBatchSchema, with one row in three sections. */
const batchFixture = () => ({
  batchId: randomUUID(),
  sentAt: "2026-10-10T06:00:00Z",
  source: { provider: "garmin", via: "companion" },
  daily: [{ externalId: "d1", date: "2026-10-09", metric: "steps", value: 9000, unit: "count" }],
  sleep: [
    {
      externalId: "s1",
      start: "2026-10-08T22:30:00Z",
      end: "2026-10-09T06:00:00Z",
      stages: [{ stage: "deep", start: "2026-10-08T23:00:00Z", end: "2026-10-08T23:40:00Z" }],
    },
  ],
  workouts: [
    { externalId: "w1", type: "strength_training", start: "2026-10-09T17:00:00Z", end: "2026-10-09T18:00:00Z", sets: [{ exercise: "bench_press", reps: 8, weightKg: 80 }] },
  ],
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/ingest/v1/batches`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const { code } = await app.get(DevicesService).createPairing(owner);
  ({ token, deviceId } = await app.get(DevicesService).redeemPairing(code, { platform: "cli" }));
});

afterAll(async () => {
  const { db } = app.get(DbService);
  const sources = await db.select({ id: healthSources.id }).from(healthSources).where(eq(healthSources.ownerEmail, owner));
  const ids = sources.map((s) => s.id);
  for (const t of [ingestBatches, dailyMetrics, pointMetrics, sleepSessions, workouts]) {
    await db.delete(t).where(eq(t.ownerEmail, owner));
  }
  await db.delete(healthSources).where(eq(healthSources.ownerEmail, owner));
  await db.delete(deviceTokens).where(eq(deviceTokens.ownerEmail, owner));
  await db.delete(devicePairings).where(eq(devicePairings.ownerEmail, owner));
  await db.delete(rateLimits).where(inArray(rateLimits.key, [`ingest:req:${deviceId}`, `ingest:bytes:${deviceId}`]));
  void ids;
  await app.close();
});

test("a batch with no bearer token → 401", async () => {
  const res = await post(batchFixture());
  expect(res.status).toBe(401);
});

test("a valid batch → 200 with a batchId, duplicate:false, stored counts and plan", async () => {
  const batch = batchFixture();
  const res = await post(batch, auth());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.batchId).toBe(batch.batchId);
  expect(body.duplicate).toBe(false);
  expect(body.stored).toMatchObject({ daily: 1, sleep: 1, workouts: 1, points: 0, deleted: 0 });
  expect(body.plan).toBeTruthy();
});

test("the same batch id twice is idempotent (2nd → duplicate:true)", async () => {
  const batch = batchFixture();
  await post(batch, auth());
  const res2 = await post(batch, auth());
  expect(res2.status).toBe(200);
  expect((await res2.json()).duplicate).toBe(true);
});

test("a malformed body → 400 invalid_payload (not 500)", async () => {
  const res = await post({ nope: 1 }, auth());
  expect(res.status).toBe(400);
  expect((await res.json()).errorCode).toBe("invalid_payload");
});

test("the encrypted raw column is sealed at rest in the real write path", async () => {
  const batch = batchFixture();
  const res = await post(batch, auth());
  expect(res.status).toBe(200);
  const { db } = app.get(DbService);
  const [row] = await db.execute<{ raw: string }>(sql`select raw from ingest_batches where batch_id = ${batch.batchId}`);
  expect(row?.raw).toMatch(/^enc:v1:/);
  expect(row?.raw).not.toMatch(/garmin/);
});
