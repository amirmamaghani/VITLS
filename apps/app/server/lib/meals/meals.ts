/**
 * Food log (docs/design/06-nutrition.md §3, §5). Items carry a nutrient snapshot for the eaten amount; every write
 * recomputes the affected days' intake metrics. Owner-scoped: another user's meal id behaves as "not found".
 */
import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { recordChange, runWithRequestContext } from "@agent-native/core/server";
import type { NutrientKey } from "@vitls/health-ingest";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { sumNutrients, type LogMealInput, type MealItemInput, type MealView, type Nutrients } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import { getCoachProfile } from "../coach/profile";
import { getFoods, upsertFoods, type Food, type ImportedFood } from "../foods/store";
import type { OwnerScope } from "../ingest/devices";
import { foodSourceId, lockIntakeDays, recomputeIntakeDayIn } from "./intake";

const MAX_ITEMS = 40;

const localDateOf = (at: Date, timezone: string) => {
  try {
    return at.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return at.toLocaleDateString("en-CA", { timeZone: "UTC" }); // invalid profile timezone
  }
};

function scale(per: Nutrients, amount: number): Nutrients {
  return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(((v as number) * amount) / 100 * 100) / 100])) as Nutrients;
}

type ResolvedItem = { foodId: string | null; name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated: boolean };

function resolveItem(item: MealItemInput, foods: Map<string, Food>): ResolvedItem {
  if ("foodId" in item) {
    const food = foods.get(item.foodId);
    if (!food) fail(`Food ${item.foodId} not found — search-foods first`, { statusCode: 400, errorCode: "food_not_found" });
    const basisUnit = food.basis === "100ml" ? "ml" : "g";
    let amount = item.amount;
    if (item.portion) {
      const portion = food.portions.find((p) => p.label === item.portion);
      if (!portion) fail(`${food.name} has no portion "${item.portion}" (has: ${food.portions.map((p) => p.label).join(", ") || "none"})`, { statusCode: 400, errorCode: "unknown_portion" });
      amount = item.amount * portion.amount;
    } else if (item.unit && item.unit !== basisUnit) {
      fail(`${food.name} is measured per 100 ${basisUnit}; give the amount in ${basisUnit}`, { statusCode: 400, errorCode: "unit_mismatch" });
    }
    if (!(amount > 0 && amount <= 10_000)) fail(`Amount for ${food.name} must be between 0 and 10 kg`, { statusCode: 400, errorCode: "invalid_amount" });
    return { foodId: food.id, name: food.brand ? `${food.name} (${food.brand})` : food.name, amount: Math.round(amount * 10) / 10, unit: basisUnit, nutrients: scale(food.nutrients, amount), estimated: false };
  }
  if (!(item.amount > 0 && item.amount <= 10_000)) fail(`Amount for ${item.name} must be between 0 and 10 kg`, { statusCode: 400, errorCode: "invalid_amount" });
  const nutrients = Object.fromEntries(Object.entries(item.nutrients).filter(([, v]) => Number.isFinite(v) && (v as number) >= 0)) as Nutrients;
  return { foodId: null, name: item.name.trim().slice(0, 120), amount: item.amount, unit: item.unit, nutrients, estimated: item.estimated ?? true };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Owner-scoped meal; inside a transaction it is locked (FOR UPDATE) so a concurrent update/delete waits. */
async function findMeal(owner: OwnerScope, mealId: string, tx?: Tx) {
  const query = (tx ?? getDb()).select().from(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, owner.userEmail)));
  const [meal] = tx ? await query.for("update") : await query;
  return meal;
}

async function ownedMeal(owner: OwnerScope, mealId: string, tx?: Tx) {
  const meal = await findMeal(owner, mealId, tx);
  if (!meal) fail("Meal not found", { statusCode: 404, errorCode: "meal_not_found" });
  return meal;
}

async function itemsOf(owner: OwnerScope, mealIds: string[]) {
  if (mealIds.length === 0) return [];
  return getDb()
    .select()
    .from(schema.mealItems)
    .where(and(eq(schema.mealItems.ownerEmail, owner.userEmail), inArray(schema.mealItems.mealId, mealIds)))
    .orderBy(asc(schema.mealItems.position));
}

function toView(meal: typeof schema.meals.$inferSelect, items: (typeof schema.mealItems.$inferSelect)[]): MealView {
  const views = items.map((i) => ({ id: i.id, foodId: i.foodId, name: i.name ?? "", amount: i.amount, unit: i.unit, nutrients: JSON.parse(i.nutrients) as Nutrients, estimated: i.estimated === 1 }));
  return {
    id: meal.id,
    eatenAt: meal.eatenAt.toISOString(),
    localDate: meal.localDate,
    mealType: meal.mealType ?? null,
    note: meal.note ?? null,
    entry: meal.entry,
    source: meal.source,
    items: views,
    totals: sumNutrients(views.map((v) => v.nutrients)),
  };
}

export async function logMeal(owner: OwnerScope, input: LogMealInput): Promise<MealView> {
  return runWithRequestContext({ userEmail: owner.userEmail, orgId: owner.orgId ?? undefined }, async () => {
    const db = getDb();
    const { profile } = await getCoachProfile(owner.userEmail);
    const timezone = profile.timezone ?? "UTC";
    const template = input.fromMealId ? await ownedMeal(owner, input.fromMealId) : null;

    let items: ResolvedItem[] | null = null;
    if (input.items) {
      if (input.items.length === 0 || input.items.length > MAX_ITEMS) fail(`A meal needs 1–${MAX_ITEMS} items`, { statusCode: 400, errorCode: "invalid_items" });
      const foodIds = input.items.flatMap((i) => ("foodId" in i ? [i.foodId] : []));
      const foods = await getFoods([...new Set(foodIds)], owner.userEmail);
      items = input.items.map((i) => resolveItem(i, foods));
    } else if (template) {
      items = (await itemsOf(owner, [template.id])).map((i) => ({ foodId: i.foodId, name: i.name ?? "", amount: i.amount, unit: i.unit, nutrients: JSON.parse(i.nutrients) as Nutrients, estimated: i.estimated === 1 }));
    } else if (!input.mealId) {
      fail("Give items or fromMealId", { statusCode: 400, errorCode: "invalid_items" });
    }
    if (input.eatenAt && Number.isNaN(Date.parse(input.eatenAt))) fail("eatenAt must be an ISO timestamp", { statusCode: 400, errorCode: "invalid_time" });
    const now = new Date().toISOString();
    const id = input.mealId ?? randomUUID();
    const owned = { ownerEmail: owner.userEmail, orgId: owner.orgId, visibility: "private" as const };

    await db.transaction(async (tx) => {
      // Re-read under a row lock: a meal deleted meanwhile is "not found", never updated into orphan items.
      const existing = input.mealId ? await ownedMeal(owner, input.mealId, tx) : null;
      const eatenAt = input.eatenAt ? new Date(input.eatenAt) : (existing?.eatenAt ?? new Date());
      const localDate = localDateOf(eatenAt, timezone);
      const days = [...new Set([localDate, existing?.localDate].filter((d): d is string => !!d))];
      const sourceId = await foodSourceId(owner, tx);
      await lockIntakeDays(tx, owner, days);
      const values = {
        eatenAt,
        localDate,
        mealType: input.mealType !== undefined ? input.mealType : (existing?.mealType ?? template?.mealType ?? null),
        note: input.note !== undefined ? input.note : (existing?.note ?? null),
        updatedAt: now,
      };
      if (existing) {
        await tx.update(schema.meals).set(values).where(and(eq(schema.meals.id, id), eq(schema.meals.ownerEmail, owner.userEmail)));
      } else {
        await tx.insert(schema.meals).values({ id, ...values, entry: template ? "copy" : (input.entry ?? "manual"), source: "vitls", createdAt: now, ...owned });
      }
      if (items) {
        await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, id), eq(schema.mealItems.ownerEmail, owner.userEmail)));
        await tx.insert(schema.mealItems).values(
          items.map((item, position) => ({ id: randomUUID(), mealId: id, position, foodId: item.foodId, name: item.name, amount: item.amount, unit: item.unit, nutrients: JSON.stringify(item.nutrients), estimated: item.estimated ? 1 : 0, ...owned })),
        );
      }
      for (const day of days) await recomputeIntakeDayIn(tx, owner, day, sourceId);
    });

    recordChange({ source: "health", type: "meal", key: id, owner: owner.userEmail, orgId: owner.orgId ?? undefined });
    return toView(await ownedMeal(owner, id), await itemsOf(owner, [id]));
  });
}

export async function deleteMeal(owner: OwnerScope, mealId: string): Promise<{ deleted: boolean }> {
  const deleted = await getDb().transaction(async (tx) => {
    const meal = await findMeal(owner, mealId, tx);
    if (!meal) return false;
    const sourceId = await foodSourceId(owner, tx);
    await lockIntakeDays(tx, owner, [meal.localDate]);
    await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, mealId), eq(schema.mealItems.ownerEmail, owner.userEmail)));
    await tx.delete(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, owner.userEmail)));
    await recomputeIntakeDayIn(tx, owner, meal.localDate, sourceId);
    return true;
  });
  if (!deleted) return { deleted: false };
  recordChange({ source: "health", type: "meal", key: mealId, owner: owner.userEmail, orgId: owner.orgId ?? undefined });
  return { deleted: true };
}

export async function listMeals(owner: OwnerScope, range: { from: string; to: string }): Promise<MealView[]> {
  const meals = await getDb()
    .select()
    .from(schema.meals)
    .where(and(eq(schema.meals.ownerEmail, owner.userEmail), gte(schema.meals.localDate, range.from), lte(schema.meals.localDate, range.to)))
    .orderBy(asc(schema.meals.eatenAt));
  const items = await itemsOf(owner, meals.map((m) => m.id));
  return meals.map((m) => toView(m, items.filter((i) => i.mealId === m.id)));
}

/** A user's own food (e.g. read from a nutrition-label photo); visible only to them. */
export async function createFood(owner: OwnerScope, food: Omit<ImportedFood, "source" | "sourceRef" | "createdBy">): Promise<Food> {
  const known = Object.keys(food.nutrients) as NutrientKey[];
  if (!known.includes("energy")) fail("A custom food needs at least energy (kcal per 100 g/ml)", { statusCode: 400, errorCode: "invalid_food" });
  const { ids } = await upsertFoods([{ ...food, source: "custom", sourceRef: randomUUID(), createdBy: owner.userEmail }]);
  return (await getFoods(ids, owner.userEmail)).get(ids[0]!)!;
}
