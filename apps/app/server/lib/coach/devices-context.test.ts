import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { createPairing, redeemPairing } from "../ingest/devices";
import { devicesContext } from "./devices-context";

const owner = { userEmail: "dev@example.com", orgId: "org_dev" };

describe("devices context block", () => {
  beforeAll(setupTestDb);

  it("says no device is paired yet", async () => {
    expect(await devicesContext(owner)).toContain("no device paired");
  });

  it("lists paired devices, last batch and missing metrics", async () => {
    const { code } = await createPairing(owner);
    await redeemPairing(code, { platform: "android", model: "Pixel 8" });
    const block = await devicesContext(owner);
    expect(block).toMatch(/<devices>[\s\S]*android[\s\S]*<\/devices>/);
    expect(block).toContain("last batch: never");
  });
});
