import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { getReadout, saveReadout } from "./readout";

const ana = "ana@example.com";
const input = { date: "2026-10-07", directive: "Easy zone 2 for 40 minutes.", highlights: [{ metric: "hrv_rmssd_night", note: "12 % below baseline" }] };

describe("coach readout", () => {
  beforeAll(setupTestDb);

  it("reads null before anything is saved", async () => {
    expect(await getReadout(ana)).toBeNull();
  });

  it("saves, reads back and overwrites", async () => {
    await saveReadout(ana, input);
    expect(await getReadout(ana)).toEqual(input);
    await saveReadout(ana, { ...input, date: "2026-10-08", highlights: [] });
    expect(await getReadout(ana)).toMatchObject({ date: "2026-10-08", highlights: [] });
  });

  it("rejects more than 3 highlights and an over-long directive", async () => {
    const h = { metric: "weight", note: "stable" };
    await expect(saveReadout(ana, { ...input, highlights: [h, h, h, h] })).rejects.toThrow();
    await expect(saveReadout(ana, { ...input, directive: "x".repeat(281) })).rejects.toThrow();
    await expect(saveReadout(ana, { ...input, date: "yesterday" })).rejects.toThrow();
  });

  it("keeps an optional greeting of at most 80 characters", async () => {
    await saveReadout(ana, { ...input, greeting: "Ana, three nights over 8 h. Keep it up." });
    expect(await getReadout(ana)).toMatchObject({ greeting: "Ana, three nights over 8 h. Keep it up." });
    await expect(saveReadout(ana, { ...input, greeting: "x".repeat(81) })).rejects.toThrow();
  });

  it("keeps readouts per user", async () => {
    expect(await getReadout("bob@example.com")).toBeNull();
  });
});
