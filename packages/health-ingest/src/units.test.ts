import { describe, expect, it } from "vitest";

import { normalizeValue } from "./units";

describe("normalizeValue", () => {
  it("keeps values already in the canonical unit", () => {
    expect(normalizeValue("weight", 82.4, "kg")).toBe(82.4);
    expect(normalizeValue("steps", 10234, "count")).toBe(10234);
  });

  it("converts mass to kilograms", () => {
    expect(normalizeValue("weight", 82400, "g")).toBeCloseTo(82.4);
    expect(normalizeValue("weight", 181.66, "lb")).toBeCloseTo(82.4, 1);
  });

  it("converts energy to kilocalories", () => {
    expect(normalizeValue("active_energy", 4184, "kJ")).toBeCloseTo(1000);
  });

  it("converts durations to seconds", () => {
    expect(normalizeValue("sleep_duration", 7.5, "h")).toBe(27000);
    expect(normalizeValue("sleep_duration", 450, "min")).toBe(27000);
  });

  it("converts distance to metres", () => {
    expect(normalizeValue("distance", 5.2, "km")).toBe(5200);
  });

  it("rejects units that do not fit the metric's dimension", () => {
    expect(() => normalizeValue("weight", 10, "km")).toThrow(/unit/i);
  });

  it("rejects unknown metrics", () => {
    expect(() => normalizeValue("not_a_metric", 1, "count")).toThrow(/metric/i);
  });

  it("rejects non-finite values", () => {
    expect(() => normalizeValue("weight", Number.NaN, "kg")).toThrow(/finite/i);
  });
});
