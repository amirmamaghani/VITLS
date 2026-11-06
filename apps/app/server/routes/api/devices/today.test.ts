import { getResponseStatus, mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import { createPairing, redeemPairing, revokeDevice } from "../../../lib/ingest/devices";
import handler from "./today.get";

vi.mock("@agent-native/core/org", async (importOriginal) => ({ ...(await importOriginal<object>()), isOrgMember: async () => true }));

const owner = { userEmail: "ron@example.com", orgId: "org_ron" };
const get = (token?: string) =>
  mockEvent("http://localhost/api/devices/today", { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("GET /api/devices/today", () => {
  beforeAll(setupTestDb);

  it("returns the view for a paired device", async () => {
    const { code } = await createPairing(owner);
    const { token } = await redeemPairing(code, { platform: "android" });
    const body = (await handler(get(token))) as { date: string; metrics: object };
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.metrics).toEqual({});
  });

  it("answers 401 without a token and after revocation", async () => {
    const event = get();
    expect(await handler(event)).toMatchObject({ errorCode: "unauthorized" });
    expect(getResponseStatus(event)).toBe(401);
    const { code } = await createPairing(owner);
    const { token, deviceId } = await redeemPairing(code, { platform: "android" });
    await revokeDevice(owner, deviceId);
    const revoked = get(token);
    expect(await handler(revoked)).toMatchObject({ errorCode: "unauthorized" });
    expect(getResponseStatus(revoked)).toBe(401);
  });
});
