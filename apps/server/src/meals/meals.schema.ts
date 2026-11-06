/** Meal types + zod input schemas (ported from apps/app/shared/meals.ts + the log-meal/create-food actions). */
import { z } from "zod";

// @vitls/health-ingest is ESM-only: types via import(), values (NUTRIENTS) via the dynamic import in mealSchemas().
type HI = typeof import("@vitls/health-ingest", { with: { "resolution-mode": "import" } });
export type NutrientKey = import("@vitls/health-ingest", { with: { "resolution-mode": "import" } }).NutrientKey;
type NutrientUnit = import("@vitls/health-ingest", { with: { "resolution-mode": "import" } }).NutrientUnit;

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;

/** Sanity ceilings for one item or 100 g/ml in canonical units; anything larger is a typo or a unit mix-up. */
const NUTRIENT_MAX: Record<NutrientUnit, number> = { kcal: 20_000, g: 100_000, mg: 100_000, ug: 100_000, ml: 100_000 };

export interface MealItemView {
  id: string;
  foodId: string | null;
  name: string;
  amount: number;
  unit: "g" | "ml";
  nutrients: Nutrients;
  estimated: boolean;
}

export interface MealView {
  id: string;
  eatenAt: string;
  localDate: string;
  mealType: MealType | null;
  note: string | null;
  entry: string;
  source: string;
  items: MealItemView[];
  totals: Nutrients;
}

export type MealItemInput =
  | { foodId: string; amount: number; unit?: "g" | "ml"; portion?: string }
  | { name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated?: boolean };

export interface LogMealInput {
  mealId?: string;
  fromMealId?: string;
  eatenAt?: string;
  mealType?: MealType | null;
  note?: string;
  entry?: "photo" | "barcode" | "search" | "manual" | "copy";
  items?: MealItemInput[];
}

export interface CreateFoodInput {
  name: string;
  brand?: string;
  barcode?: string;
  basis: "100g" | "100ml";
  nutrients: Nutrients;
  portions?: { label: string; amount: number }[];
}

/** Sums nutrient maps, skipping missing and non-finite values. */
export function sumNutrients(list: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const n of list) {
    for (const [k, v] of Object.entries(n) as [NutrientKey, number][]) {
      if (Number.isFinite(v)) out[k] = Math.round(((out[k] ?? 0) + v) * 100) / 100;
    }
  }
  return out;
}

let cached: Promise<{ logMeal: z.ZodType<LogMealInput>; createFood: z.ZodType<CreateFoodInput> }> | undefined;

/** Request schemas; built once because the nutrient keys come from the ESM-only package. */
export function mealSchemas() {
  cached ??= (async () => {
    const { NUTRIENTS }: HI = await import("@vitls/health-ingest");
    const nutrients = z.object(Object.fromEntries(NUTRIENTS.map((n) => [n.key, z.number().nonnegative().finite().max(NUTRIENT_MAX[n.unit]).optional()])));
    const item = z.union([
      z.object({ foodId: z.string(), amount: z.number().positive(), unit: z.enum(["g", "ml"]).optional(), portion: z.string().max(80).optional() }),
      z.object({ name: z.string().trim().min(1).max(120), amount: z.number().positive(), unit: z.enum(["g", "ml"]), nutrients, estimated: z.boolean().optional() }),
    ]);
    return {
      logMeal: z.object({
        mealId: z.string().optional(),
        fromMealId: z.string().optional(),
        eatenAt: z.string().datetime({ offset: true }).optional(),
        mealType: z.enum(MEAL_TYPES).nullable().optional(),
        note: z.string().max(500).optional(),
        entry: z.enum(["photo", "barcode", "search", "manual"]).optional(),
        items: z.array(item).min(1).max(40).optional(),
      }) as unknown as z.ZodType<LogMealInput>,
      createFood: z.object({
        name: z.string().trim().min(1).max(120),
        brand: z.string().trim().max(80).optional(),
        barcode: z.string().regex(/^\d{8,14}$/).optional(),
        basis: z.enum(["100g", "100ml"]).default("100g"),
        nutrients,
        portions: z.array(z.object({ label: z.string().trim().min(1).max(80), amount: z.number().positive() })).max(10).optional(),
      }) as unknown as z.ZodType<CreateFoodInput>,
    };
  })();
  return cached;
}
