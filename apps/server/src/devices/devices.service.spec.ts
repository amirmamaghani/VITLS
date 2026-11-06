import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { LIMITS } from "../common/rate-limit/limits";
import { devicePairings, deviceTokens, expoPushTokens, healthSources } from "../db/schema";
import { DevicesService } from "./devices.service";
import { PushService } from "./push.service";

describe("DevicesService", () => {
  const dbs = new DbService();
  const push = new PushService(dbs);
  const svc = new DevicesService(dbs, push);
  const run = Date.now();
  const owner = `dev-a-${run}@t.co`;
  const limitOwner = `dev-limit-${run}@t.co`;
  const otherOwner = `dev-b-${run}@t.co`;
  const owners = [owner, limitOwner, otherOwner];

  afterAll(async () => {
    await dbs.db.delete(devicePairings).where(inArray(devicePairings.ownerEmail, owners));
    await dbs.db.delete(healthSources).where(inArray(healthSources.ownerEmail, owners));
    await dbs.db.delete(expoPushTokens).where(inArray(expoPushTokens.ownerEmail, owners));
    await dbs.db.delete(deviceTokens).where(inArray(deviceTokens.ownerEmail, owners));
    await dbs.onModuleDestroy();
  });

  test("redeem issues a vdt_ token and is single-use", async () => {
    const { code } = await svc.createPairing(owner);
    const { token, deviceId } = await svc.redeemPairing(code, { platform: "ios" });
    expect(token).toMatch(/^vdt_/);
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(svc.redeemPairing(code, { platform: "ios" })).rejects.toMatchObject({ status: 400 });
  });

  test("authenticate resolves a live token, null for revoked or non-vdt", async () => {
    const { code } = await svc.createPairing(owner);
    const { token, deviceId } = await svc.redeemPairing(code, { platform: "ios" });
    expect(await svc.authenticateDeviceToken(token)).toMatchObject({ userEmail: owner, scope: "ingest:write", deviceId });
    await svc.revokeDevice(owner, deviceId);
    expect(await svc.authenticateDeviceToken(token)).toBeNull();
    expect(await svc.authenticateDeviceToken("nope")).toBeNull();
  });

  test("selfPair issues a usable device token without a code (the signed-in phone pairs itself)", async () => {
    const { token, deviceId } = await svc.selfPair(owner, { platform: "android", model: "Pixel 10" });
    expect(await svc.authenticateDeviceToken(token)).toMatchObject({ userEmail: owner, scope: "ingest:write", deviceId });
  });

  test("createPairing enforces the open-pairing limit with 429", async () => {
    for (let i = 0; i < LIMITS.openPairingsPerUser; i++) await svc.createPairing(limitOwner);
    await expect(svc.createPairing(limitOwner)).rejects.toMatchObject({
      status: 429,
      response: { errorCode: "too_many_pairings" },
    });
  });

  test("revokeDevice marks the device's sources revoked and drops its push tokens", async () => {
    const { code } = await svc.createPairing(owner);
    const { deviceId } = await svc.redeemPairing(code, { platform: "ios" });
    await dbs.db.insert(healthSources).values({
      id: randomUUID(), provider: "garmin", via: "device", deviceTokenId: deviceId,
      createdAt: new Date().toISOString(), ownerEmail: owner,
    });
    await push.addExpoToken(owner, `ExponentPushToken[rev-${run}]`, "p", deviceId);
    await svc.revokeDevice(owner, deviceId);
    const [src] = await dbs.db.select().from(healthSources).where(eq(healthSources.deviceTokenId, deviceId));
    expect(src?.status).toBe("revoked");
    expect(await dbs.db.select().from(expoPushTokens).where(eq(expoPushTokens.deviceId, deviceId))).toHaveLength(0);
  });

  test("revokeDevice for another owner is 404 and leaves the token valid", async () => {
    const { code } = await svc.createPairing(owner);
    const { token, deviceId } = await svc.redeemPairing(code, { platform: "ios" });
    await expect(svc.revokeDevice(otherOwner, deviceId)).rejects.toMatchObject({ status: 404 });
    expect(await svc.authenticateDeviceToken(token)).not.toBeNull();
  });

  test("an expired pairing code is rejected with 400", async () => {
    const { code } = await svc.createPairing(owner, { ttlMs: -1 });
    await expect(svc.redeemPairing(code, { platform: "ios" })).rejects.toMatchObject({
      status: 400,
      response: { errorCode: "invalid_pairing_code" },
    });
  });
});
