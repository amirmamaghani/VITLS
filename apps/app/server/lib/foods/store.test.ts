import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { foodByBarcode, getFoods, upsertFoods, type ImportedFood } from "./store";

const egg: ImportedFood = {
  source: "usda",
  sourceRef: "748967",
  name: "Egg, whole, raw",
  names: { fr: "Œuf entier, cru" },
  basis: "100g",
  nutrients: { energy: 143, protein: 12.6, fat: 9.5, carbs: 0.7 },
  portions: [{ label: "1 large egg", amount: 50 }],
};

describe("food store", () => {
  beforeAll(setupTestDb);

  it("inserts once and updates on re-import (idempotent on source + ref)", async () => {
    const first = await upsertFoods([egg]);
    const second = await upsertFoods([{ ...egg, nutrients: { ...egg.nutrients, protein: 12.5 } }]);
    expect(first).toMatchObject({ inserted: 1, updated: 0 });
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    expect(second.ids).toEqual(first.ids);
    const food = (await getFoods(first.ids)).get(first.ids[0]!)!;
    expect(food).toMatchObject({ name: "Egg, whole, raw", basis: "100g", portions: [{ label: "1 large egg", amount: 50 }] });
    expect(food.nutrients).toEqual({ energy: 143, protein: 12.5, fat: 9.5, carbs: 0.7 });
  });

  it("drops unknown nutrients and non-finite amounts", async () => {
    const { ids } = await upsertFoods([{ ...egg, sourceRef: "x1", nutrients: { protein: Number.NaN, energy: 10, bogus: 3 } as never }]);
    expect((await getFoods(ids)).get(ids[0]!)!.nutrients).toEqual({ energy: 10 });
  });

  it("hides another user's custom food and finds by barcode", async () => {
    const { ids } = await upsertFoods([{ ...egg, source: "custom", sourceRef: "c1", barcode: "8590000000001", createdBy: "a@example.com" }]);
    expect((await getFoods(ids, "b@example.com")).size).toBe(0);
    expect((await getFoods(ids, "a@example.com")).size).toBe(1);
    expect((await foodByBarcode("8590000000001", "a@example.com"))?.id).toBe(ids[0]);
    expect(await foodByBarcode("8590000000001", "b@example.com")).toBeNull();
    expect(await foodByBarcode("8590000000001")).toBeNull();
  });

  it("never changes ownership on re-upsert", async () => {
    const custom = { ...egg, source: "custom" as const, sourceRef: "own1", createdBy: "a@example.com" };
    const { ids } = await upsertFoods([custom]);
    await upsertFoods([{ ...custom, createdBy: "b@example.com" }]);
    await upsertFoods([{ ...custom, createdBy: undefined }]);
    expect((await getFoods(ids, "a@example.com")).size).toBe(1);
    expect((await getFoods(ids, "b@example.com")).size).toBe(0);
    expect((await getFoods(ids)).size).toBe(0);
  });

  it("keeps the scanned barcode when an OFF text search re-caches the product (final review 8)", async () => {
    const off = { source: "off" as const, sourceRef: "4001234567890", name: "Skyr", basis: "100g" as const, nutrients: { energy: 63 } };
    const { ids } = await upsertFoods([{ ...off, barcode: "04001234567890" }]);
    await upsertFoods([{ ...off, barcode: "4001234567890", name: "Skyr natural" }]);
    const food = (await getFoods(ids)).get(ids[0]!)!;
    expect(food).toMatchObject({ name: "Skyr natural", barcode: "04001234567890" });
    expect((await foodByBarcode("04001234567890"))?.id).toBe(ids[0]);
  });

  it("caches the same new product from two concurrent callers once (final review 10)", async () => {
    const off = { source: "off" as const, sourceRef: "5900000000001", barcode: "5900000000001", name: "Kefir", basis: "100ml" as const, nutrients: { energy: 50 } };
    const [a, b] = await Promise.all([upsertFoods([off]), upsertFoods([off])]);
    expect(a.ids).toEqual(b.ids);
    expect(a.inserted + b.inserted).toBe(1);
  });
});
