import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { MEAL_TYPES, nutrientsSchema } from "../shared/meals";
import { requireOwner } from "../server/lib/ingest/owner";
import { logMeal } from "../server/lib/meals/meals";

const nutrients = nutrientsSchema("Totals for this amount, canonical units (kcal, g, mg, µg, ml)");
const item = z.union([
  z.object({ foodId: z.string(), amount: z.number().positive(), unit: z.enum(["g", "ml"]).optional(), portion: z.string().max(80).optional().describe("A portion label from search-foods; amount is then the count") }),
  z.object({ name: z.string().trim().min(1).max(120), amount: z.number().positive(), unit: z.enum(["g", "ml"]), nutrients, estimated: z.boolean().optional() }),
]);

export default defineAction({
  description:
    "Log a meal to the user's food log, or update one (mealId), or repeat one (fromMealId, e.g. \"same as yesterday's breakfast\"). Items: { foodId, amount in g/ml or portion + count } from search-foods, or { name, amount, unit, nutrients } as an estimate when nothing matches. Log straight away after identifying a photo — the meal card lets the user correct amounts. Updates the day's intake totals.",
  schema: z.object({
    mealId: z.string().optional(),
    fromMealId: z.string().optional(),
    eatenAt: z.string().datetime({ offset: true }).optional().describe("When it was eaten; default now"),
    mealType: z.enum(MEAL_TYPES).nullable().optional(),
    note: z.string().max(500).optional(),
    entry: z.enum(["photo", "barcode", "search", "manual"]).optional(),
    items: z.array(item).min(1).max(40).optional(),
  }),
  chatUI: { renderer: "vitls.meal" },
  run: async (input, ctx) => ({ meal: await logMeal(await requireOwner(ctx), input) }),
});
