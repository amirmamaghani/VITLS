import type { AddressInfo } from "node:net";

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import { dashboardRevisions, dashboards } from "../db/schema";
import { DashboardController } from "./dashboard.controller";
import { SharesService } from "../shares/shares.service";
import { DashboardStore } from "./dashboard.store";

process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

const owner = `dashctl-${Date.now()}@t.co`;
const other = `dashctl-other-${Date.now()}@t.co`;
const dbs = new DbService();
const store = new DashboardStore(dbs);
const ctl = new DashboardController(store, new SharesService(dbs));
const section = { id: "w1", kind: "section", title: "Body" };
let app: NestExpressApplication;

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
});

afterAll(async () => {
  await dbs.db.delete(dashboardRevisions).where(inArray(dashboardRevisions.ownerEmail, [owner, other]));
  await dbs.db.delete(dashboards).where(inArray(dashboards.ownerEmail, [owner, other]));
  await app.close();
});

test("GET /api/dashboards without a session → 401 through the real AuthGuard", async () => {
  const port = (app.getHttpServer().address() as AddressInfo).port;
  expect((await fetch(`http://127.0.0.1:${port}/api/dashboards`)).status).toBe(401);
});

test("list seeds exactly one default board for a fresh owner", async () => {
  const list = await ctl.list(owner);
  expect(list).toHaveLength(1);
  expect(list[0]!.id).toBe(store.defaultDashboardId(owner));
  expect(await ctl.list(owner)).toHaveLength(1);
});

test("a save with an invalid widget kind → 400 and writes no revision", async () => {
  const id = store.defaultDashboardId(owner);
  await expect(ctl.save(owner, id, { config: { version: 1, widgets: [{ id: "x", kind: "nope" }] } })).rejects.toBeInstanceOf(BadRequestException);
  expect(await store.listRevisions(id, owner)).toHaveLength(0);
  await ctl.save(owner, id, { config: { version: 1, widgets: [section] } });
  await expect(ctl.save(owner, id, { title: "T2", config: { version: 1, widgets: [section] }, expectedUpdatedAt: "stale" })).rejects.toBeInstanceOf(ConflictException);
});

test("create, revisions, restore, and archive (last board → 409)", async () => {
  const id = store.defaultDashboardId(owner);
  await expect(ctl.archive(owner, id)).rejects.toBeInstanceOf(ConflictException);
  const created = await ctl.create(owner, { title: "Race" });
  const revs = await ctl.revisions(owner, id);
  expect(revs.length).toBeGreaterThan(0);
  await expect(ctl.restore(owner, id, "missing")).rejects.toBeInstanceOf(NotFoundException);
  expect((await ctl.restore(owner, id, revs[0]!.id)).id).toBe(id);
  await ctl.archive(owner, created.id);
  await expect(ctl.get(owner, created.id)).rejects.toBeInstanceOf(NotFoundException);
  await expect(ctl.archive(owner, created.id)).rejects.toBeInstanceOf(NotFoundException);
});

test("GET another owner's board → 404", async () => {
  await ctl.list(other);
  await expect(ctl.get(owner, store.defaultDashboardId(other))).rejects.toBeInstanceOf(NotFoundException);
});
