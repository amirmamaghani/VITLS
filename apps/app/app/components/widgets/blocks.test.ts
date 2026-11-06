import { describe, expect, it } from "vitest";

import { formatParts, hm } from "./blocks";

describe("hm", () => {
  it("rounds the total before splitting, so it never reads x:60", () => {
    expect(hm(7.995 * 60)).toBe("8:00");
    expect(hm(119.6)).toBe("2:00");
    expect(hm(425)).toBe("7:05");
    expect(hm(0)).toBe("0:00");
  });
  it("formatParts uses it for long durations", () => {
    expect(formatParts("sleep_duration", 7.995 * 3600)).toEqual({ value: "8:00", unit: "h" });
    expect(formatParts("sleep_duration", 1800)).toEqual({ value: "30", unit: "min" });
  });
});
