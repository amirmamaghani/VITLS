import { describe, expect, it } from "vitest";

import { METRICS, getMetric, metricsOfKind } from "./catalog";

describe("metric catalog", () => {
  it("has unique keys", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks intraday metrics as premium", () => {
    for (const m of metricsOfKind("intraday")) expect(m.tier).toBe("premium");
  });

  it("has the apple/manual body metrics", () => {
    expect(getMetric("hrv_sdnn_night")).toMatchObject({ unit: "ms", kind: "daily", aggregation: "avg" });
    expect(getMetric("lean_mass")).toMatchObject({ unit: "kg", kind: "point" });
    for (const k of ["shoulders", "chest", "hips", "neck", "arm", "thigh"]) expect(getMetric(k)).toMatchObject({ unit: "m", kind: "point" });
  });

  it("looks up metrics by key", () => {
    expect(getMetric("resting_hr")).toMatchObject({ unit: "bpm", kind: "daily" });
    expect(getMetric("nope")).toBeUndefined();
  });
});
