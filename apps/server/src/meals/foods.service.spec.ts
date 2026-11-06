import { eq, inArray } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import * as schema from "../db/schema";
import { FoodsService } from "./foods.service";
import { searchKey } from "./foods/normalize";
import type { OffFetch } from "./foods/off";

const CODE = "9990000000017";
const product = { status: 1, product: { code: CODE, product_name: "Jalapeño Chips", brands: "Acme", serving_quantity: 30, nutriments: { "energy-kcal_100g": 500, proteins_100g: 6 } } };

describe("FoodsService", () => {
  const db = new DbService();
  const svc = new FoodsService(db);
  const owner = "foods-spec@t.co";

  afterAll(async () => {
    const rows = await db.db.select({ id: schema.foods.id }).from(schema.foods).where(inArray(schema.foods.sourceRef, [CODE, "q1"]));
    const mine = await db.db.select({ id: schema.foods.id }).from(schema.foods).where(eq(schema.foods.createdBy, owner));
    const ids = [...rows, ...mine].map((r) => r.id);
    if (ids.length) {
      await db.db.delete(schema.foodNutrients).where(inArray(schema.foodNutrients.foodId, ids));
      await db.db.delete(schema.foodPortions).where(inArray(schema.foodPortions.foodId, ids));
      await db.db.delete(schema.foodNames).where(inArray(schema.foodNames.foodId, ids));
      await db.db.delete(schema.foods).where(inArray(schema.foods.id, ids));
    }
    await db.onModuleDestroy();
  });

  it("barcode miss calls the fetcher, upserts, and returns the mapped Food", async () => {
    const fetcher = vi.fn<OffFetch>(async () => ({ ok: true, json: async () => product }));
    const [food] = await svc.search(owner, { barcode: CODE, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(food).toMatchObject({ source: "off", barcode: CODE, name: "Jalapeño Chips", brand: "Acme", nutrients: { energy: 500, protein: 6 } });
    // second lookup is served from the cache
    expect(await svc.search(owner, { barcode: CODE, fetcher })).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("is fail-soft when the fetcher throws or returns not-ok", async () => {
    const boom: OffFetch = async () => {
      throw new Error("down");
    };
    const bad: OffFetch = async () => ({ ok: false, json: async () => ({}) });
    expect(await svc.search(owner, { barcode: "0000000000000", fetcher: boom })).toEqual([]);
    expect(await svc.search(owner, { query: "zzqxnope", fetcher: bad })).toEqual([]);
  });

  it("searchKey strips diacritics so Jalapeño matches jalapeno", async () => {
    expect(searchKey("Jalapeño")).toBe("jalapeno");
    const found = await svc.search(owner, { query: "jalapeno chips", fetcher: async () => ({ ok: false, json: async () => ({}) }) });
    expect(found.map((f) => f.barcode)).toContain(CODE);
  });
});
