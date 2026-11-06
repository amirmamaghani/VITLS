import { randomBytes } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import { and, eq, inArray, like } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import * as schema from "../db/schema";
import { FoodsService } from "./foods.service";
import { MealsService } from "./meals.service";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;

describe("MealsService", () => {
  const db = new DbService();
  const foods = new FoodsService(db);
  const svc = new MealsService(db, new SettingsService(db), foods);
  const mia = "meals-mia@t.co";
  const eve = "meals-eve@t.co";
  const DAY = "2026-10-05";
  const at = `${DAY}T12:00:00Z`;
  let foodId = "";

  const intake = async () =>
    db.db.select().from(schema.dailyMetrics).where(and(eq(schema.dailyMetrics.ownerEmail, mia), eq(schema.dailyMetrics.day, DAY), like(schema.dailyMetrics.metric, "intake_%")));

  beforeAll(async () => {
    foodId = (await svc.createFood(mia, { name: "Meals Spec Rice", basis: "100g", nutrients: { energy: 130, protein: 2.7 } })).id;
  });

  afterAll(async () => {
    const meals = await db.db.select({ id: schema.meals.id }).from(schema.meals).where(inArray(schema.meals.ownerEmail, [mia, eve]));
    if (meals.length) await db.db.delete(schema.mealItems).where(inArray(schema.mealItems.mealId, meals.map((m) => m.id)));
    await db.db.delete(schema.meals).where(inArray(schema.meals.ownerEmail, [mia, eve]));
    await db.db.delete(schema.dailyMetrics).where(inArray(schema.dailyMetrics.ownerEmail, [mia, eve]));
    await db.db.delete(schema.healthSources).where(inArray(schema.healthSources.ownerEmail, [mia, eve]));
    await db.db.delete(schema.foodNutrients).where(eq(schema.foodNutrients.foodId, foodId));
    await db.db.delete(schema.foodPortions).where(eq(schema.foodPortions.foodId, foodId));
    await db.db.delete(schema.foodNames).where(eq(schema.foodNames.foodId, foodId));
    await db.db.delete(schema.foods).where(eq(schema.foods.id, foodId));
    await db.onModuleDestroy();
  });

  it("logs a meal, returns totals and writes intake rows under the owner's vitls/food source", async () => {
    const meal = await svc.logMeal(mia, { eatenAt: at, note: "lunch", items: [{ foodId, amount: 200, unit: "g" }] });
    expect(meal).toMatchObject({ localDate: DAY, note: "lunch", totals: { energy: 260, protein: 5.4 } });
    expect(meal.items[0]).toMatchObject({ name: "Meals Spec Rice", amount: 200, unit: "g" });
    const rows = await intake();
    expect(rows.find((r) => r.metric === "intake_energy")?.value).toBe(260);
    const [src] = await db.db.select().from(schema.healthSources).where(eq(schema.healthSources.id, rows[0]!.sourceId));
    expect(src).toMatchObject({ ownerEmail: mia, provider: "vitls", via: "food" });
  });

  it("treats another owner's meal id as not found", async () => {
    const meal = await svc.logMeal(mia, { eatenAt: at, items: [{ foodId, amount: 100 }] });
    await expect(svc.logMeal(eve, { mealId: meal.id, note: "x" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.logMeal(eve, { fromMealId: meal.id })).rejects.toBeInstanceOf(NotFoundException);
    expect(await svc.deleteMeal(eve, meal.id)).toEqual({ deleted: false });
  });

  it("replaces (not doubles) the day's intake when a meal is re-logged, and delete zeroes it", async () => {
    for (const m of await svc.listMeals(mia, { from: DAY, to: DAY })) await svc.deleteMeal(mia, m.id);
    const meal = await svc.logMeal(mia, { eatenAt: at, items: [{ foodId, amount: 100 }] });
    const again = await svc.logMeal(mia, { mealId: meal.id, items: [{ foodId, amount: 100 }] });
    expect(again.id).toBe(meal.id);
    expect((await intake()).find((r) => r.metric === "intake_energy")?.value).toBe(130);

    expect(await svc.deleteMeal(mia, meal.id)).toEqual({ deleted: true });
    expect(await intake()).toEqual([]);
    expect(await db.db.select().from(schema.mealItems).where(eq(schema.mealItems.mealId, meal.id))).toEqual([]);
  });
});
