import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createApp } from "../src/app.factory";
import { DbService } from "../src/common/db/db.service";
import { dailyMetrics, deviceTokens, devicePairings, healthSources, ingestBatches, rateLimits } from "../src/db/schema";
import { DevicesService } from "../src/devices/devices.service";

process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

// The real gccli-sync client keeps its state at a fixed path; move any existing one aside for the test.
const gccliDir = join(__dirname, "..", "..", "gccli-sync");
const STATE = join(gccliDir, ".state", "state.json");
const BACKUP = `${STATE}.e2e-bak`;
const owner = `e2e-${Date.now()}@vitls.test`;
let app: NestExpressApplication;
let base: string;
let deviceId = "";

beforeAll(async () => {
  if (existsSync(STATE)) await rename(STATE, BACKUP);
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  const { db } = app.get(DbService);
  for (const t of [ingestBatches, dailyMetrics]) await db.delete(t).where(eq(t.ownerEmail, owner));
  await db.delete(healthSources).where(eq(healthSources.ownerEmail, owner));
  await db.delete(deviceTokens).where(eq(deviceTokens.ownerEmail, owner));
  await db.delete(devicePairings).where(eq(devicePairings.ownerEmail, owner));
  if (deviceId) await db.delete(rateLimits).where(inArray(rateLimits.key, [`ingest:req:${deviceId}`, `ingest:bytes:${deviceId}`]));
  await app.close();
  await rm(STATE, { force: true });
  if (existsSync(BACKUP)) await rename(BACKUP, STATE);
});

test("real gccli pair client redeems a code, then its token ingests a batch", async () => {
  const { code } = await app.get(DevicesService).createPairing(owner);

  // The unmodified shipped client, spawned as a child process (same as `pnpm gccli:pair`).
  const { stdout } = await promisify(execFile)("pnpm", ["exec", "tsx", "src/cli.ts", "pair", code, "--server", base], { cwd: gccliDir });
  expect(stdout).toContain("Paired with");

  const state = JSON.parse(await readFile(STATE, "utf8")) as { server: string; token: string; deviceId: string };
  deviceId = state.deviceId;
  expect(state.server).toBe(base);

  // Identical to gccli push().
  const batch = {
    batchId: randomUUID(),
    sentAt: "2026-10-10T06:00:00Z",
    source: { provider: "garmin", via: "companion" },
    daily: [{ externalId: "d1", date: "2026-10-09", metric: "steps", value: 9000, unit: "count" }],
  };
  const res = await fetch(`${state.server}/api/ingest/v1/batches`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${state.token}` },
    body: JSON.stringify(batch),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).stored).toMatchObject({ daily: 1 });

  const { db } = app.get(DbService);
  const sources = await db.select().from(healthSources).where(eq(healthSources.ownerEmail, owner));
  expect(sources).toHaveLength(1);
}, 60_000);
