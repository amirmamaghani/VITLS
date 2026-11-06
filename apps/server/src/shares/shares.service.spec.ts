import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { eq, or } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { dataShares } from "../db/schema";
import { SharesService } from "./shares.service";

describe("SharesService", () => {
  const dbs = new DbService();
  const svc = new SharesService(dbs);
  const run = Date.now();
  const X = `share-x-${run}@t.co`;
  const doctor = `share-doc-${run}@t.co`;
  const doctorB = `share-docb-${run}@t.co`;

  afterAll(async () => {
    await dbs.db.delete(dataShares).where(or(eq(dataShares.ownerEmail, X), eq(dataShares.granteeEmail, doctor)));
    await dbs.onModuleDestroy();
  });

  test("owner and self resolve to the session user", async () => {
    expect(await svc.resolveReadOwner(X)).toBe(X);
    expect(await svc.resolveReadOwner(X, X)).toBe(X);
  });

  test("ungranted user is forbidden", async () => {
    await expect(svc.resolveReadOwner(doctor, X)).rejects.toBeInstanceOf(ForbiddenException);
  });

  test("grant, list, revoke, re-grant", async () => {
    await svc.grant(X, doctor);
    expect(await svc.resolveReadOwner(doctor, X)).toBe(X);
    await expect(svc.resolveReadOwner(doctorB, X)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.listGrantsByOwner(X)).map((g) => [g.granteeEmail, g.role, g.revokedAt])).toEqual([[doctor, "read", null]]);
    expect((await svc.listGrantsToGrantee(doctor)).map((g) => [g.ownerEmail, g.role])).toEqual([[X, "read"]]);

    await svc.revoke(X, doctor);
    await expect(svc.resolveReadOwner(doctor, X)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await svc.listGrantsToGrantee(doctor)).toEqual([]);
    expect((await svc.listGrantsByOwner(X))[0]?.revokedAt).toEqual(expect.any(String));

    await svc.grant(X, doctor);
    expect(await svc.resolveReadOwner(doctor, X)).toBe(X);
    expect((await svc.listGrantsByOwner(X))[0]?.revokedAt).toBeNull();
  });

  test("rejects self-grant and non-read roles", async () => {
    await expect(svc.grant(X, X)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.grant(X, doctor, "write")).rejects.toBeInstanceOf(BadRequestException);
  });
});
