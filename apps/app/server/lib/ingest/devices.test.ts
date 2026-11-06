import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import {
  authenticateDeviceToken,
  createPairing,
  listDevices,
  redeemPairing,
  revokeDevice,
  type OwnerScope,
} from "./devices";

const alice: OwnerScope = { userEmail: "alice@example.com", orgId: "org_alice" };
const bob: OwnerScope = { userEmail: "bob@example.com", orgId: "org_bob" };
const device = { platform: "ios", model: "iPhone 17", appVersion: "1.0.0" };

describe("device pairing", () => {
  beforeAll(setupTestDb);

  it("pairs a device with a one-time code and issues a write-only token", async () => {
    const { code, expiresAt } = await createPairing(alice);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const { token, deviceId } = await redeemPairing(code, device);
    expect(token).toMatch(/^vdt_/);

    const identity = await authenticateDeviceToken(token);
    expect(identity).toMatchObject({ deviceId, userEmail: alice.userEmail, orgId: alice.orgId, scope: "ingest:write" });
  });

  it("accepts codes case-insensitively and without the dash", async () => {
    const { code } = await createPairing(alice);
    const { token } = await redeemPairing(code.replace(/-/g, "").toLowerCase(), device);
    expect(await authenticateDeviceToken(token)).not.toBeNull();
  });

  it("rejects a code that was already used", async () => {
    const { code } = await createPairing(alice);
    await redeemPairing(code, device);
    await expect(redeemPairing(code, device)).rejects.toThrow(/invalid or expired/i);
  });

  it("rejects an unknown code", async () => {
    await expect(redeemPairing("ZZZZ-ZZZZ-ZZZZ", device)).rejects.toThrow(/invalid or expired/i);
  });

  it("rejects an expired code", async () => {
    const { code } = await createPairing(alice, { ttlMs: -1 });
    await expect(redeemPairing(code, device)).rejects.toThrow(/invalid or expired/i);
  });

  it("caps the number of open pairing codes per user", async () => {
    const carol = { userEmail: "carol@example.com", orgId: "org_carol" };
    for (let i = 0; i < 5; i++) await createPairing(carol);
    await expect(createPairing(carol)).rejects.toThrow(/too many open pairing codes/i);
  });

  it("rejects unknown and malformed tokens", async () => {
    expect(await authenticateDeviceToken("vdt_nope")).toBeNull();
    expect(await authenticateDeviceToken("Bearer something")).toBeNull();
    expect(await authenticateDeviceToken("")).toBeNull();
  });

  it("lists only the caller's devices and never returns token material", async () => {
    const { code } = await createPairing(bob);
    await redeemPairing(code, device);
    const aliceDevices = await listDevices(alice);
    const bobDevices = await listDevices(bob);
    expect(bobDevices).toHaveLength(1);
    expect(aliceDevices.every((d) => !("tokenHash" in d))).toBe(true);
    expect(aliceDevices.length).toBeGreaterThan(0);
  });

  it("revokes a device so its token stops working", async () => {
    const { code } = await createPairing(alice);
    const { token, deviceId } = await redeemPairing(code, device);
    await revokeDevice(alice, deviceId);
    expect(await authenticateDeviceToken(token)).toBeNull();
  });

  it("does not let another user revoke a device", async () => {
    const { code } = await createPairing(alice);
    const { token, deviceId } = await redeemPairing(code, device);
    await expect(revokeDevice(bob, deviceId)).rejects.toThrow(/not found/i);
    expect(await authenticateDeviceToken(token)).not.toBeNull();
  });
});
