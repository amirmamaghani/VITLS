/**
 * Food log domain (ported from apps/app/server/lib/meals/meals.ts). Items carry a nutrient snapshot for the eaten
 * amount; every write recomputes the affected days' intake metrics. Owner-scoped: another user's meal id is "not found".
 * Callers (MealsService) run these inside runWithOwner — meals.note / meal_items.name are encrypted.
 */
import { randomUUID } from "node:crypto";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import type { DbService } from "../common/db/db.service";
import * as schema from "../db/schema";
import type { Food } from "./foods/store";
import { foodSourceId, lockIntakeDays, recomputeIntakeDayIn, type Tx } from "./intake";
import { sumNutrients, type LogMealInput, type MealItemInput, type MealView, type Nutrients } from "./meals.schema";

const MAX_ITEMS = 40;
type Db = DbService["db"];
export type GetFoods = (ids: string[]) => Promise<Map<string, Food>>;

const localDateOf = (at: Date, timezone: string) => {
  try {
    return at.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return at.toLocaleDateString("en-CA", { timeZone: "UTC" }); // invalid timezone
  }
};

function scale(per: Nutrients, amount: number): Nutrients {
  return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(((v as number) * amount) / 100 * 100) / 100])) as Nutrients;
}

type ResolvedItem = { foodId: string | null; name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated: boolean };

function resolveItem(item: MealItemInput, foods: Map<string, Food>): ResolvedItem {
  if ("foodId" in item) {
    const food = foods.get(item.foodId);
    if (!food) throw new BadRequestException(`Food ${item.foodId} not found — search-foods first`);
    const basisUnit = food.basis === "100ml" ? "ml" : "g";
    let amount = item.amount;
    if (item.portion) {
      const portion = food.portions.find((p) => p.label === item.portion);
      if (!portion) throw new BadRequestException(`${food.name} has no portion "${item.portion}" (has: ${food.portions.map((p) => p.label).join(", ") || "none"})`);
      amount = item.amount * portion.amount;
    } else if (item.unit && item.unit !== basisUnit) {
      throw new BadRequestException(`${food.name} is measured per 100 ${basisUnit}; give the amount in ${basisUnit}`);
    }
    if (!(amount > 0 && amount <= 10_000)) throw new BadRequestException(`Amount for ${food.name} must be between 0 and 10 kg`);
    return { foodId: food.id, name: food.brand ? `${food.name} (${food.brand})` : food.name, amount: Math.round(amount * 10) / 10, unit: basisUnit, nutrients: scale(food.nutrients, amount), estimated: false };
  }
  if (!(item.amount > 0 && item.amount <= 10_000)) throw new BadRequestException(`Amount for ${item.name} must be between 0 and 10 kg`);
  const nutrients = Object.fromEntries(Object.entries(item.nutrients).filter(([, v]) => Number.isFinite(v) && (v as number) >= 0)) as Nutrients;
  return { foodId: null, name: item.name.trim().slice(0, 120), amount: item.amount, unit: item.unit, nutrients, estimated: item.estimated ?? true };
}

/** Owner-scoped meal; inside a transaction it is locked (FOR UPDATE) so a concurrent update/delete waits. */
async function findMeal(db: Db | Tx, ownerEmail: string, mealId: string, locked = false) {
  const query = db.select().from(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, ownerEmail)));
  const [meal] = locked ? await query.for("update") : await query;
  return meal;
}

async function ownedMeal(db: Db | Tx, ownerEmail: string, mealId: string, locked = false) {
  const meal = await findMeal(db, ownerEmail, mealId, locked);
  if (!meal) throw new NotFoundException("Meal not found");
  return meal;
}

async function itemsOf(db: Db, ownerEmail: string, mealIds: string[]) {
  if (mealIds.length === 0) return [];
  return db
    .select()
    .from(schema.mealItems)
    .where(and(eq(schema.mealItems.ownerEmail, ownerEmail), inArray(schema.mealItems.mealId, mealIds)))
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

export async function logMeal(db: Db, ownerEmail: string, timezone: string, getFoods: GetFoods, input: LogMealInput): Promise<MealView> {
  const template = input.fromMealId ? await ownedMeal(db, ownerEmail, input.fromMealId) : null;

  let items: ResolvedItem[] | null = null;
  if (input.items) {
    if (input.items.length === 0 || input.items.length > MAX_ITEMS) throw new BadRequestException(`A meal needs 1–${MAX_ITEMS} items`);
    const foods = await getFoods([...new Set(input.items.flatMap((i) => ("foodId" in i ? [i.foodId] : [])))]);
    items = input.items.map((i) => resolveItem(i, foods));
  } else if (template) {
    items = (await itemsOf(db, ownerEmail, [template.id])).map((i) => ({ foodId: i.foodId, name: i.name ?? "", amount: i.amount, unit: i.unit, nutrients: JSON.parse(i.nutrients) as Nutrients, estimated: i.estimated === 1 }));
  } else if (!input.mealId) {
    throw new BadRequestException("Give items or fromMealId");
  }
  if (input.eatenAt && Number.isNaN(Date.parse(input.eatenAt))) throw new BadRequestException("eatenAt must be an ISO timestamp");
  const now = new Date().toISOString();
  const id = input.mealId ?? randomUUID();

  await db.transaction(async (tx) => {
    // Re-read under a row lock: a meal deleted meanwhile is "not found", never updated into orphan items.
    const existing = input.mealId ? await ownedMeal(tx, ownerEmail, input.mealId, true) : null;
    const eatenAt = input.eatenAt ? new Date(input.eatenAt) : (existing?.eatenAt ?? new Date());
    const localDate = localDateOf(eatenAt, timezone);
    const days = [...new Set([localDate, existing?.localDate].filter((d): d is string => !!d))];
    const sourceId = await foodSourceId(ownerEmail, tx);
    await lockIntakeDays(tx, ownerEmail, days);
    const values = {
      eatenAt,
      localDate,
      mealType: input.mealType !== undefined ? input.mealType : (existing?.mealType ?? template?.mealType ?? null),
      note: input.note !== undefined ? input.note : (existing?.note ?? null),
      updatedAt: now,
    };
    if (existing) {
      await tx.update(schema.meals).set(values).where(and(eq(schema.meals.id, id), eq(schema.meals.ownerEmail, ownerEmail)));
    } else {
      await tx.insert(schema.meals).values({ id, ...values, entry: template ? "copy" : (input.entry ?? "manual"), source: "vitls", createdAt: now, ownerEmail });
    }
    if (items) {
      await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, id), eq(schema.mealItems.ownerEmail, ownerEmail)));
      await tx.insert(schema.mealItems).values(
        items.map((item, position) => ({ id: randomUUID(), mealId: id, position, foodId: item.foodId, name: item.name, amount: item.amount, unit: item.unit, nutrients: JSON.stringify(item.nutrients), estimated: item.estimated ? 1 : 0, ownerEmail })),
      );
    }
    for (const day of days) await recomputeIntakeDayIn(tx, ownerEmail, day, sourceId);
  });

  return toView(await ownedMeal(db, ownerEmail, id), await itemsOf(db, ownerEmail, [id]));
}

/** No FK constraints: the meal's items are deleted explicitly, then the day's intake is recomputed. */
export async function deleteMeal(db: Db, ownerEmail: string, mealId: string): Promise<{ deleted: boolean }> {
  return db.transaction(async (tx) => {
    const meal = await findMeal(tx, ownerEmail, mealId, true);
    if (!meal) return { deleted: false };
    const sourceId = await foodSourceId(ownerEmail, tx);
    await lockIntakeDays(tx, ownerEmail, [meal.localDate]);
    await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, mealId), eq(schema.mealItems.ownerEmail, ownerEmail)));
    await tx.delete(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, ownerEmail)));
    await recomputeIntakeDayIn(tx, ownerEmail, meal.localDate, sourceId);
    return { deleted: true };
  });
}

export async function listMeals(db: Db, ownerEmail: string, range: { from: string; to: string }): Promise<MealView[]> {
  const meals = await db
    .select()
    .from(schema.meals)
    .where(and(eq(schema.meals.ownerEmail, ownerEmail), gte(schema.meals.localDate, range.from), lte(schema.meals.localDate, range.to)))
    .orderBy(asc(schema.meals.eatenAt));
  const items = await itemsOf(db, ownerEmail, meals.map((m) => m.id));
  return meals.map((m) => toView(m, items.filter((i) => i.mealId === m.id)));
}
