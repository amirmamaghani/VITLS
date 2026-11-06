/** Meal types shared by actions and UI (docs/design/06-nutrition.md §3). meal_type = the HealthKit / Health Connect enum. */
import { NUTRIENTS, type NutrientKey, type NutrientUnit } from "@vitls/health-ingest";
import { z } from "zod";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = (typeof MEAL_TYPES)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;

/** Sanity ceilings for one item or 100 g/ml in canonical units; anything larger is a typo or a unit mix-up. */
const NUTRIENT_MAX: Record<NutrientUnit, number> = { kcal: 20_000, g: 100_000, mg: 100_000, ug: 100_000, ml: 100_000 };

/** Action schema for a nutrient map (log-meal items, create-food). */
export const nutrientsSchema = (description: string) =>
  z.object(Object.fromEntries(NUTRIENTS.map((n) => [n.key, z.number().nonnegative().finite().max(NUTRIENT_MAX[n.unit]).optional()]))).describe(description);

interface MealItemView {
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
