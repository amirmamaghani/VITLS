import { BUILT_IN_INTEGRATION_ADAPTER_IDS } from "@agent-native/core/integrations";
import { describe, expect, it } from "vitest";

import { COACH_CHANNELS } from "./channels";

describe("COACH_CHANNELS", () => {
  it("names only platforms the framework ships an adapter for (a typo would throw at plugin init)", () => {
    for (const id of COACH_CHANNELS) expect(BUILT_IN_INTEGRATION_ADAPTER_IDS, id).toContain(id);
  });

  it("keeps the personal channels and leaves workplace tools out", () => {
    expect([...COACH_CHANNELS]).toEqual(["telegram", "whatsapp", "email"]);
  });
});
