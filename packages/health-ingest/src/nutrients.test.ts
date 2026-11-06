import { describe, expect, expectTypeOf, it } from "vitest";

import { getMetric } from "./catalog";
import { NUTRIENTS, getNutrient, intakeMetric, isNutrientKey, type NutrientKey } from "./nutrients";
import { normalizeValue } from "./units";

describe("nutrient catalog", () => {
  it("maps every nutrient to a daily summed intake metric in the same unit", () => {
    for (const n of NUTRIENTS) {
      const m = getMetric(intakeMetric(n.key));
      expect(m, n.key).toMatchObject({ kind: "daily", aggregation: "sum", unit: n.unit, tier: "free" });
    }
  });

  it("covers the macro set with HealthKit and Health Connect ids", () => {
    for (const key of ["energy", "protein", "fat", "carbs", "fiber", "sugars", "sodium", "water"]) {
      const n = getNutrient(key);
      expect(n?.healthKit, key).toMatch(/^HKQuantityTypeIdentifierDietary/);
      expect(n?.healthConnect, key).toBeTruthy();
    }
    expect(isNutrientKey("protein")).toBe(true);
    expect(isNutrientKey("intake_protein")).toBe(false);
  });

  it("converts mg/g and l/ml", () => {
    expect(normalizeValue("intake_sodium", 1.2, "g")).toBeCloseTo(1200);
    expect(normalizeValue("intake_protein", 500, "mg")).toBeCloseTo(0.5);
    expect(normalizeValue("intake_water", 1.5, "l")).toBeCloseTo(1500);
  });

  it("NutrientKey is a literal union, not string", () => {
    // Type guard works: isNutrientKey narrows to literal NutrientKey
    const key: string = "protein";
    if (isNutrientKey(key)) {
      // Type narrowing: key is now "protein", not string
      expectTypeOf(key).toMatchTypeOf<NutrientKey>();
    }
  });

  it("has unique nutrient keys", () => {
    const keys = NUTRIENTS.map((n) => n.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
