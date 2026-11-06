import { getDbExec } from "@agent-native/core/db";
import { mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";
import { createPairing, redeemPairing } from "./devices";
import { deviceRoute, requireDevice, throttleRedeem } from "./http";
import { hitRateLimit, LIMITS, purgeStaleRateLimits } from "./rate-limit";

const members = new Set<string>();
vi.mock("@agent-native/core/org", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isOrgMember: async (orgId: string, email: string) => members.has(`${orgId}|${email}`),
}));

async function pairedToken(userEmail: string, orgId: string) {
  members.add(`${orgId}|${userEmail}`);
  const { code } = await createPairing({ userEmail, orgId });
  return (await redeemPairing(code, { platform: "cli" })).token;
}

const bearer = (token: string, ip = "198.51.100.7") =>
  mockEvent("http://localhost/api/ingest/v1/batches", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-forwarded-for": ip } });

describe("rate limiter", () => {
  beforeAll(setupTestDb);

  it("allows up to the limit within a window and blocks after", async () => {
    const rule = { windowMs: 60_000, limit: 3 };
    const results = await Promise.all(Array.from({ length: 5 }, () => hitRateLimit("t:concurrent", rule)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("resets after the window expires", async () => {
    const rule = { windowMs: 1, limit: 1 };
    expect(await hitRateLimit("t:reset", rule)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(await hitRateLimit("t:reset", rule)).toBe(true);
  });

  it("counts amounts (byte quotas)", async () => {
    const rule = { windowMs: 60_000, limit: 100 };
    expect(await hitRateLimit("t:bytes", rule, 60)).toBe(true);
    expect(await hitRateLimit("t:bytes", rule, 60)).toBe(false);
  });
});

describe("requireDevice", () => {
  it("accepts a valid token of a current org member", async () => {
    const token = await pairedToken("dana@example.com", "org_dana");
    await expect(requireDevice(bearer(token))).resolves.toMatchObject({ userEmail: "dana@example.com" });
  });

  it("rejects a token once its owner left the organization", async () => {
    const token = await pairedToken("erik@example.com", "org_x");
    members.delete("org_x|erik@example.com");
    await expect(requireDevice(bearer(token))).rejects.toMatchObject({ statusCode: 403 });
  });

  it("counts every authenticated request toward the per-device limit", async () => {
    const token = await pairedToken("finn@example.com", "org_finn");
    const outcomes = await Promise.allSettled(
      Array.from({ length: LIMITS.ingestRequests.limit + 5 }, () => requireDevice(bearer(token))),
    );
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(5);
  });
});

describe("throttleRedeem", () => {
  it("limits pairing attempts per client", async () => {
    const event = () => mockEvent("http://localhost/api/devices/redeem", { method: "POST", headers: { "x-nf-client-connection-ip": "203.0.113.9" } });
    const outcomes = await Promise.allSettled(Array.from({ length: LIMITS.redeemPerClient.limit + 2 }, () => throttleRedeem(event())));
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(2);
  });

  it("ignores client-controlled X-Forwarded-For", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: LIMITS.redeemPerClient.limit + 2 }, (_, i) =>
        throttleRedeem(mockEvent("http://localhost/api/devices/redeem", { method: "POST", headers: { "x-nf-client-connection-ip": "203.0.113.10", "x-forwarded-for": `10.0.0.${i}` } })),
      ),
    );
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(2);
  });
});

describe("rate-limit retention", () => {
  it("purges stale counters", async () => {
    await hitRateLimit("t:stale", { windowMs: 1, limit: 1 });
    await getDbExec().execute("UPDATE rate_limits SET window_start = 0 WHERE key = 't:stale'");
    expect(await purgeStaleRateLimits()).toBeGreaterThan(0);
  });
});

describe("deviceRoute error mapping", () => {
  it("maps malformed JSON to 400 without logging request content", async () => {
    const event = mockEvent("http://localhost/x");
    const spy = vi.spyOn(console, "error");
    const result = await deviceRoute(event, async () => JSON.parse('{"code":"SECRET-CODE",'));
    expect(result).toMatchObject({ errorCode: "invalid_json" });
    expect(event.res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs only the error class for unexpected failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deviceRoute(mockEvent("http://localhost/x"), async () => {
      throw new Error("db failed for weight=82.4");
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("82.4");
  });
});
