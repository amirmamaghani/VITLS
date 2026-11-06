import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseUsda } from "./usda";

const dir = fileURLToPath(new URL("./fixtures/usda", import.meta.url));

describe("parseUsda", () => {
  const foods = parseUsda(dir);

  it("keeps Foundation and SR Legacy, skips branded", () => {
    expect(foods.map((f) => f.sourceRef).sort()).toEqual(["171287", "748967"]);
  });

  it("maps nutrients and falls back to Atwater energy", () => {
    const foundation = foods.find((f) => f.sourceRef === "748967")!;
    expect(foundation).toMatchObject({ source: "usda", basis: "100g", name: "Eggs, Grade A, Large, egg whole" });
    expect(foundation.nutrients).toEqual({ energy: 148, protein: 12.4, fat: 9.96 });
    const legacy = foods.find((f) => f.sourceRef === "171287")!;
    expect(legacy.nutrients).toEqual({ energy: 143, protein: 12.56, sodium: 142 });
  });

  it("builds portion labels from unit/modifier", () => {
    const legacy = foods.find((f) => f.sourceRef === "171287")!;
    expect(legacy.portions).toEqual([
      { label: "1 large", amount: 50 },
      { label: "1 cup (4.86 large eggs)", amount: 243 },
    ]);
  });
});
