import { getResponseStatus, mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import { getHealth } from "../../../lib/health/read";
import { createPairing, redeemPairing } from "../../../lib/ingest/devices";
import handler from "./log.post";

vi.mock("@agent-native/core/org", async (importOriginal) => ({ ...(await importOriginal<object>()), isOrgMember: async () => true }));

const owner = { userEmail: "lea@example.com", orgId: "org_lea" };
const post = (token: string, body: unknown) =>
  mockEvent("http://localhost/api/devices/log", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/devices/log", () => {
  beforeAll(setupTestDb);
  let token = "";
  beforeAll(async () => {
    const { code } = await createPairing(owner);
    token = (await redeemPairing(code, { platform: "ios" })).token;
  });

  it("stores a weight as a manual point", async () => {
    expect(await handler(post(token, { entries: [{ metric: "weight", value: 81.4, date: "2026-10-10" }] }))).toEqual({ stored: 1 });
    const h = await getHealth(owner.userEmail, { from: "2026-10-10", to: "2026-10-10", include: ["points"] });
    expect(h.points!.weight!.values[0]).toMatchObject({ value: 81.4, source: "manual" });
  });

  it("rejects intake and intraday metrics with 400", async () => {
    const event = post(token, { entries: [{ metric: "intake_energy", value: 500, date: "2026-10-10" }] });
    expect(await handler(event)).toMatchObject({ errorCode: "invalid_entry" });
    expect(getResponseStatus(event)).toBe(400);
    const heart = post(token, { entries: [{ metric: "heart_rate", value: 70, date: "2026-10-10" }] });
    expect(await handler(heart)).toMatchObject({ errorCode: "invalid_entry" });
    expect(getResponseStatus(heart)).toBe(400);
    const h = await getHealth(owner.userEmail, { from: "2026-10-10", to: "2026-10-10", include: ["daily", "points"] });
    expect(h.daily?.intake_energy).toBeUndefined();
    expect(h.points?.heart_rate).toBeUndefined();
  });

  it("rejects more than 20 entries", async () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({ metric: "weight", value: 80 + i, date: "2026-10-10" }));
    expect(await handler(post(token, { entries }))).toMatchObject({ errorCode: "invalid_payload" });
  });
});
