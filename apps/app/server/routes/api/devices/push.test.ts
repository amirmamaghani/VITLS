import { getResponseStatus, mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import { createPairing, redeemPairing, revokeDevice } from "../../../lib/ingest/devices";
import { listEntries } from "../../../lib/notifications/web-push";
import del from "./push.delete";
import post from "./push.post";

vi.mock("@agent-native/core/org", async (importOriginal) => ({ ...(await importOriginal<object>()), isOrgMember: async () => true }));

const owner = { userEmail: "pia@example.com", orgId: "org_pia" };
const call = (method: "POST" | "DELETE", token: string, body: unknown) =>
  mockEvent("http://localhost/api/devices/push", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function paired() {
  const { code } = await createPairing(owner);
  return redeemPairing(code, { platform: "ios" });
}

const expoEntries = async () => (await listEntries(owner.userEmail)).filter((e) => e.kind === "expo");

describe("/api/devices/push", () => {
  beforeAll(setupTestDb);

  it("registers a paired device's Expo token bound to that device, and DELETE removes it", async () => {
    const { token, deviceId } = await paired();
    expect(await post(call("POST", token, { expoToken: "ExponentPushToken[one]", label: "iPhone" }))).toEqual({ ok: true });
    expect(await expoEntries()).toEqual([expect.objectContaining({ kind: "expo", token: "ExponentPushToken[one]", label: "iPhone", deviceId })]);
    expect(await del(call("DELETE", token, { expoToken: "ExponentPushToken[one]" }))).toEqual({ ok: true });
    expect(await expoEntries()).toEqual([]);
  });

  it("rejects a token that is not an Expo push token with 400", async () => {
    const { token } = await paired();
    const event = call("POST", token, { expoToken: "https://push.example/not-expo" });
    expect(await post(event)).toMatchObject({ error: expect.any(String) });
    expect(getResponseStatus(event)).toBe(400);
    expect(await expoEntries()).toEqual([]);
  });

  it("revoking the device removes only its Expo tokens", async () => {
    const a = await paired();
    const b = await paired();
    await post(call("POST", a.token, { expoToken: "ExponentPushToken[aaa]" }));
    await post(call("POST", b.token, { expoToken: "ExponentPushToken[bbb]" }));
    await revokeDevice(owner, a.deviceId);
    expect((await expoEntries()).map((e) => e.kind === "expo" && e.token)).toEqual(["ExponentPushToken[bbb]"]);
    // the revoked device can no longer call DELETE itself
    const event = call("DELETE", a.token, { expoToken: "ExponentPushToken[aaa]" });
    expect(await del(event)).toMatchObject({ errorCode: "unauthorized" });
    expect(getResponseStatus(event)).toBe(401);
  });
});
