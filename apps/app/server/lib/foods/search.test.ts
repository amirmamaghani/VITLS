import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { offProduct, type OffFetch } from "./off";
import { searchFoods } from "./search";
import { upsertFoods } from "./store";

const product = JSON.parse(readFileSync(new URL("./fixtures/off-product.json", import.meta.url), "utf8"));
const offOk: OffFetch = async () => ({ ok: true, json: async () => product });
const offDown: OffFetch = (_url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

describe("food search", () => {
  beforeAll(async () => {
    await setupTestDb();
    await upsertFoods([
      { source: "ciqual", sourceRef: "1", name: "Quark, half-fat", names: { sk: "Tvaroh polotučný" }, basis: "100g", nutrients: { protein: 11 } },
      { source: "usda", sourceRef: "2", name: "Cheese, cottage, lowfat", basis: "100g", nutrients: { protein: 12 } },
      { source: "usda", sourceRef: "3", name: "Chicken breast, roasted", basis: "100g", nutrients: { protein: 31 } },
      { source: "custom", sourceRef: "c1", name: "Mia's protein pancakes", basis: "100g", nutrients: { protein: 20 }, createdBy: "mia@example.com" },
    ]);
  });

  it("matches Slovak names without diacritics and ranks prefix matches first", async () => {
    const results = await searchFoods({ query: "tvaroh polotucny", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 });
    expect(results[0]?.name).toBe("Quark, half-fat");
  });

  it("finds by any token and shows custom foods only to their author", async () => {
    expect((await searchFoods({ query: "chicken", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 }))[0]?.name).toBe("Chicken breast, roasted");
    expect(await searchFoods({ query: "pancakes", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 })).toEqual([]);
    expect((await searchFoods({ query: "pancakes", viewer: "mia@example.com", fetcher: offDown, timeoutMs: 50 }))[0]?.source).toBe("custom");
  });

  it("maps an Open Food Facts product (salt → sodium) and caches it by barcode", async () => {
    const mapped = await offProduct("8594001234567", offOk);
    expect(mapped).toMatchObject({ source: "off", barcode: "8594001234567", brand: "Madeta", portions: [{ label: "1 serving", amount: 250 }] });
    expect(mapped!.nutrients).toMatchObject({ energy: 121, protein: 12.5, sodium: 40 });
    const [first] = await searchFoods({ barcode: "8594001234567", viewer: "x@example.com", fetcher: offOk });
    const [cached] = await searchFoods({ barcode: "8594001234567", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 });
    expect(cached?.id).toBe(first?.id);
  });

  it("does not treat % or _ in a query as wildcards", async () => {
    expect(await searchFoods({ query: "%%", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 })).toEqual([]);
    expect(await searchFoods({ query: "50%", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 })).toEqual([]);
  });

  it("treats null/empty nutriments as missing, so sodium falls back to salt", async () => {
    const withNulls = { ...product, product: { ...product.product, nutriments: { ...product.product.nutriments, sodium_100g: null, "potassium_100g": "", salt_100g: "0.25" } } };
    const mapped = await offProduct("8594001234567", async () => ({ ok: true, json: async () => withNulls }));
    expect(mapped!.nutrients.sodium).toBeCloseTo(100);
    expect(mapped!.nutrients).not.toHaveProperty("potassium");
  });

  it("caches under the requested barcode even when OFF returns a normalized code", async () => {
    const normalized: OffFetch = async () => ({ ok: true, json: async () => ({ ...product, code: "4001234567890" }) });
    const [first] = await searchFoods({ barcode: "04001234567890", viewer: "x@example.com", fetcher: normalized });
    expect(first?.barcode).toBe("04001234567890");
    const [again] = await searchFoods({ barcode: "04001234567890", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 });
    expect(again?.id).toBe(first?.id);
  });

  it("returns local results when Open Food Facts is down (Review Focus 5)", async () => {
    const started = Date.now();
    const results = await searchFoods({ query: "cottage", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 });
    expect(results[0]?.name).toBe("Cheese, cottage, lowfat");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps the exact match when more than 300 longer names match (final review 2)", async () => {
    const many = Array.from({ length: 320 }, (_, i) => ({ source: "usda" as const, sourceRef: `ck${i}`, name: `Chicken, broilers or fryers, variant ${i}`, basis: "100g" as const, nutrients: { protein: 20 } }));
    await upsertFoods([...many, { source: "usda", sourceRef: "ck-exact", name: "Chicken", basis: "100g", nutrients: { protein: 27 } }]);
    const results = await searchFoods({ query: "chicken", viewer: "x@example.com", fetcher: offDown, timeoutMs: 50 });
    expect(results[0]?.name).toBe("Chicken");
  });

  it("drops impossible OFF nutriment values and skips a product without a sane energy (final review 9)", async () => {
    const odd = (nutriments: Record<string, unknown>) => async () => ({ ok: true, json: async () => ({ ...product, product: { ...product.product, nutriments: { ...product.product.nutriments, ...nutriments } } }) });
    const mapped = await offProduct("8594001234567", odd({ proteins_100g: 1250, fat_100g: -3 }));
    expect(mapped!.nutrients).not.toHaveProperty("protein");
    expect(mapped!.nutrients).not.toHaveProperty("fat");
    expect(await offProduct("8594001234567", odd({ "energy-kcal_100g": 4800 }))).toBeNull();
  });
});
