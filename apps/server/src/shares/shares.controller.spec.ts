import type { AddressInfo } from "node:net";

import { BadRequestException } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import { dataShares } from "../db/schema";
import { SharesController } from "./shares.controller";
import { SharesService } from "./shares.service";

process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

const t = Date.now();
const owner = `shctl-owner-${t}@t.co`;
const doctor = `shctl-doc-${t}@t.co`;
const dbs = new DbService();
const ctl = new SharesController(new SharesService(dbs));
let app: NestExpressApplication;

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
});

afterAll(async () => {
  await dbs.db.delete(dataShares).where(inArray(dataShares.ownerEmail, [owner]));
  await app.close();
});

test("POST /api/shares without a session → 401 through the real AuthGuard", async () => {
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grantee: doctor }) });
  expect(res.status).toBe(401);
});

test("grant appears in owner's granted and grantee's sharedWithMe; revoke drops it", async () => {
  expect(await ctl.grant(owner, { grantee: doctor })).toEqual({ message: "Shared." });
  expect((await ctl.list(owner)).granted.map((g) => g.granteeEmail)).toEqual([doctor]);
  expect((await ctl.list(doctor)).sharedWithMe.map((g) => g.ownerEmail)).toEqual([owner]);
  expect(await ctl.revoke(owner, doctor)).toEqual({ message: "Revoked." });
  expect((await ctl.list(doctor)).sharedWithMe).toHaveLength(0);
});

test("granting your own email → 400; malformed grantee → 400", async () => {
  await expect(ctl.grant(owner, { grantee: owner })).rejects.toBeInstanceOf(BadRequestException);
  await expect(ctl.grant(owner, { grantee: "nope" })).rejects.toBeInstanceOf(BadRequestException);
});

test("mixed-case grantee is stored lowercased and matched", async () => {
  await ctl.grant(owner, { grantee: `  ${doctor.toUpperCase()} ` });
  expect((await ctl.list(doctor)).sharedWithMe.map((g) => g.ownerEmail)).toEqual([owner]);
  await ctl.revoke(owner, doctor.toUpperCase());
  expect((await ctl.list(doctor)).sharedWithMe).toHaveLength(0);
});
