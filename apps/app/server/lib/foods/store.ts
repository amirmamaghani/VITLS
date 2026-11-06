/**
 * Food reference store (docs/design/06-nutrition.md §2–§3). Imports and the Open Food Facts cache go through
 * upsertFoods, idempotent on (source, source_ref). Reference foods are shared; custom foods are visible to their author.
 */
import { randomUUID } from "node:crypto";

import { isNutrientKey, type NutrientKey } from "@vitls/health-ingest";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";
import { searchKey } from "./normalize";

export type FoodSource = "usda" | "ciqual" | "bls" | "off" | "custom";

export interface ImportedFood {
  source: FoodSource;
  sourceRef: string;
  name: string;
  names?: Record<string, string>;
  brand?: string;
  barcode?: string;
  basis: "100g" | "100ml";
  nutrients: Partial<Record<NutrientKey, number>>;
  portions?: { label: string; amount: number }[];
  createdBy?: string;
}

export interface Food {
  id: string;
  source: FoodSource;
  name: string;
  brand: string | null;
  barcode: string | null;
  basis: "100g" | "100ml";
  nutrients: Partial<Record<NutrientKey, number>>;
  portions: { label: string; amount: number }[];
}

const CHUNK = 200;

export async function upsertFoods(rows: ImportedFood[]): Promise<{ inserted: number; updated: number; ids: string[] }> {
  const db = getDb();
  const now = new Date().toISOString();
  const ids: string[] = [];
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const row of chunk) {
        const byRef = and(eq(schema.foods.source, row.source), eq(schema.foods.sourceRef, row.sourceRef));
        const values = { name: row.name, brand: row.brand ?? null, barcode: row.barcode ?? null, basis: row.basis, refreshedAt: now };
        let [existing] = await tx.select({ id: schema.foods.id, barcode: schema.foods.barcode }).from(schema.foods).where(byRef);
        let foodId: string | undefined;
        if (!existing) {
          // Conflict-safe: two users caching the same new product at once must not hit the unique index.
          // Ownership (created_by) is fixed at insert and never changed by a re-upsert.
          const [created] = await tx
            .insert(schema.foods)
            .values({ id: randomUUID(), source: row.source, sourceRef: row.sourceRef, createdBy: row.createdBy ?? null, ...values })
            .onConflictDoNothing({ target: [schema.foods.source, schema.foods.sourceRef] })
            .returning({ id: schema.foods.id });
          if (created) {
            foodId = created.id;
            inserted++;
          } else {
            [existing] = await tx.select({ id: schema.foods.id, barcode: schema.foods.barcode }).from(schema.foods).where(byRef);
          }
        }
        if (existing) {
          const id = (foodId = existing.id);
          // OFF text search reports OFF's own code; keep the barcode a scan cached the product under.
          const barcode = row.source === "off" && existing.barcode ? existing.barcode : values.barcode;
          await tx.update(schema.foods).set({ ...values, barcode }).where(eq(schema.foods.id, id));
          await tx.delete(schema.foodNutrients).where(eq(schema.foodNutrients.foodId, id));
          await tx.delete(schema.foodPortions).where(eq(schema.foodPortions.foodId, id));
          await tx.delete(schema.foodNames).where(eq(schema.foodNames.foodId, id));
          updated++;
        }
        if (!foodId) throw new Error(`Food ${row.source}/${row.sourceRef} could not be stored`);
        const id = foodId;
        const nutrients = Object.entries(row.nutrients).filter(([k, v]) => isNutrientKey(k) && typeof v === "number" && Number.isFinite(v) && v >= 0);
        if (nutrients.length) await tx.insert(schema.foodNutrients).values(nutrients.map(([nutrient, amount]) => ({ foodId: id, nutrient, amount: amount! })));
        const portions = [...new Map((row.portions ?? []).filter((p) => p.amount > 0).map((p) => [p.label, p])).values()];
        if (portions.length) await tx.insert(schema.foodPortions).values(portions.map((p) => ({ foodId: id, label: p.label, amount: p.amount })));
        const names = { en: row.name, ...row.names };
        await tx.insert(schema.foodNames).values(
          Object.entries(names)
            .filter(([, name]) => name?.trim())
            .map(([lang, name]) => ({ foodId: id, lang, name, searchName: searchKey(`${name} ${row.brand ?? ""}`) })),
        );
        ids.push(id);
      }
    });
  }
  return { inserted, updated, ids };
}

/** Loads foods by id; custom foods are returned only to their author. */
export async function getFoods(ids: string[], viewer?: string): Promise<Map<string, Food>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const visible = viewer ? or(isNull(schema.foods.createdBy), eq(schema.foods.createdBy, viewer)) : isNull(schema.foods.createdBy);
  const rows = await db.select().from(schema.foods).where(and(inArray(schema.foods.id, ids), visible));
  const found = rows.map((r) => r.id);
  if (found.length === 0) return new Map();
  const nutrients = await db.select().from(schema.foodNutrients).where(inArray(schema.foodNutrients.foodId, found));
  const portions = await db.select().from(schema.foodPortions).where(inArray(schema.foodPortions.foodId, found));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        source: r.source,
        name: r.name,
        brand: r.brand,
        barcode: r.barcode,
        basis: r.basis,
        nutrients: Object.fromEntries(nutrients.filter((n) => n.foodId === r.id).map((n) => [n.nutrient, n.amount])),
        portions: portions.filter((p) => p.foodId === r.id).map((p) => ({ label: p.label, amount: p.amount })),
      },
    ]),
  );
}

export async function foodByBarcode(barcode: string, viewer?: string): Promise<Food | null> {
  const [row] = await getDb()
    .select({ id: schema.foods.id })
    .from(schema.foods)
    .where(and(eq(schema.foods.barcode, barcode), viewer ? or(isNull(schema.foods.createdBy), eq(schema.foods.createdBy, viewer)) : isNull(schema.foods.createdBy)))
    .orderBy(sql`case when ${schema.foods.source} = 'custom' then 0 else 1 end`)
    .limit(1);
  return row ? ((await getFoods([row.id], viewer)).get(row.id) ?? null) : null;
}
