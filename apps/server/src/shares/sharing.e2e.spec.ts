import { randomBytes } from "node:crypto";

import { ForbiddenException } from "@nestjs/common";
import { eq, inArray, or } from "drizzle-orm";

import { CoachController } from "../coach/coach.controller";
import { CoachService } from "../coach/coach.service";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import { DashboardController } from "../dashboard/dashboard.controller";
import { DashboardStore } from "../dashboard/dashboard.store";
import * as schema from "../db/schema";
import { HealthReadController } from "../health/health.controller";
import { HealthService } from "../health/health.service";
import { IngestService } from "../ingest/ingest.service";
import { FoodsService } from "../meals/foods.service";
import { MealsController } from "../meals/meals.controller";
import { MealsService } from "../meals/meals.service";
import { SharesService } from "./shares.service";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;

describe("read sharing across controllers", () => {
  const dbs = new DbService();
  const settings = new SettingsService(dbs);
  const foods = new FoodsService(dbs);
  const mealsSvc = new MealsService(dbs, settings, foods);
  const shares = new SharesService(dbs);
  const health = new HealthReadController(new HealthService(dbs, mealsSvc, new IngestService(dbs), settings), shares);
  const dash = new DashboardController(new DashboardStore(dbs), shares);
  const coach = new CoachController(new CoachService(settings), shares);
  const meals = new MealsController(mealsSvc, foods, shares);
  const run = Date.now();
  const X = `sharing-x-${run}@t.co`;
  const doc = `sharing-doc-${run}@t.co`;
  const docB = `sharing-docb-${run}@t.co`;
  const range = { from: "2026-10-01", to: "2026-10-03" };
  const steps = (r: Awaited<ReturnType<typeof health.get>>) => r.daily?.steps?.values.map((v) => v.value) ?? [];
  let foodId = "";
  const foodIds: string[] = [];

  beforeAll(async () => {
    await dbs.db.insert(schema.healthSources).values({ id: `src-${run}`, provider: "apple_health", via: "app", deviceTokenId: "t", status: "active", createdAt: new Date().toISOString(), ownerEmail: X });
    await dbs.db.insert(schema.dailyMetrics).values({ sourceId: `src-${run}`, day: "2026-10-02", metric: "steps", value: 4321, unit: "count", updatedAt: new Date().toISOString(), ownerEmail: X });
    await settings.put(X, "vitls-coach", { onboardingStage: "done" });
    foodId = (await mealsSvc.createFood(X, { name: `Sharing Rice ${run}`, basis: "100g", nutrients: { energy: 130 } })).id;
    foodIds.push(foodId);
    await mealsSvc.logMeal(X, { eatenAt: "2026-10-02T12:00:00Z", note: "x-lunch", items: [{ foodId, amount: 100, unit: "g" }] });
    await dash.create(X, { title: "X board" });
    await shares.grant(X, doc);
  });

  afterAll(async () => {
    const all = [X, doc, docB];
    const ms = await dbs.db.select({ id: schema.meals.id }).from(schema.meals).where(inArray(schema.meals.ownerEmail, all));
    if (ms.length) await dbs.db.delete(schema.mealItems).where(inArray(schema.mealItems.mealId, ms.map((m) => m.id)));
    for (const t of [schema.meals, schema.dailyMetrics, schema.pointMetrics, schema.workouts, schema.ingestBatches, schema.healthSources, schema.dashboards, schema.dashboardRevisions])
      await dbs.db.delete(t).where(inArray(t.ownerEmail, all));
    await dbs.db.delete(schema.dataShares).where(or(eq(schema.dataShares.ownerEmail, X), eq(schema.dataShares.granteeEmail, doc)));
    for (const t of [schema.foodNutrients, schema.foodPortions, schema.foodNames]) await dbs.db.delete(t).where(inArray(t.foodId, foodIds));
    await dbs.db.delete(schema.foods).where(inArray(schema.foods.id, foodIds));
    await dbs.onModuleDestroy();
  });

  test("grantee reads the owner's data on every read endpoint (owner param is case-insensitive)", async () => {
    const o = ` ${X.toUpperCase()} `;
    expect(steps(await health.get(doc, { ...range, include: "daily" }, o))).toEqual([4321]);
    expect(await health.catalog(doc, X)).toBeDefined();
    expect(await health.raw(doc, { metric: "steps" }, X)).toBeDefined();
    expect((await dash.list(doc, X)).map((b) => b.title)).toEqual(["X board"]);
    expect((await coach.getProfile(doc, X)).onboarded).toBe(true);
    expect((await meals.list(doc, range, X)).map((m) => m.note)).toEqual(["x-lunch"]);
  });

  test("ungranted user is forbidden on every read endpoint", async () => {
    const f = ForbiddenException;
    await expect(health.get(docB, { ...range }, X)).rejects.toBeInstanceOf(f);
    await expect(health.catalog(docB, X)).rejects.toBeInstanceOf(f);
    await expect(health.raw(docB, { metric: "steps" }, X)).rejects.toBeInstanceOf(f);
    await expect(dash.list(docB, X)).rejects.toBeInstanceOf(f);
    await expect(coach.getProfile(docB, X)).rejects.toBeInstanceOf(f);
    await expect(meals.list(docB, range, X)).rejects.toBeInstanceOf(f);
  });

  test("a grantee's writes ignore ?owner and never touch the owner's data", async () => {
    const before = {
      m: await mealsSvc.listMeals(X, range),
      d: await dbs.db.select().from(schema.dailyMetrics).where(eq(schema.dailyMetrics.ownerEmail, X)),
    };
    const docFood = await mealsSvc.createFood(doc, { name: `Sharing Oats ${run}`, basis: "100g", nutrients: { energy: 370 } });
    foodIds.push(docFood.id);
    await meals.log(doc, { eatenAt: "2026-10-02T13:00:00Z", note: "doc-lunch", items: [{ foodId: docFood.id, amount: 50, unit: "g" }] });
    await health.log(doc, { entries: [{ metric: "weight", value: 70, date: "2026-10-02" }] });
    expect((await mealsSvc.listMeals(X, range)).map((m) => m.note)).toEqual(before.m.map((m) => m.note));
    expect(await dbs.db.select().from(schema.dailyMetrics).where(eq(schema.dailyMetrics.ownerEmail, X))).toEqual(before.d);
    expect((await dbs.db.select().from(schema.pointMetrics).where(eq(schema.pointMetrics.ownerEmail, X))).length).toBe(0);
    expect((await mealsSvc.listMeals(doc, range)).map((m) => m.note)).toEqual(["doc-lunch"]);
    expect((await dbs.db.select().from(schema.pointMetrics).where(eq(schema.pointMetrics.ownerEmail, doc))).length).toBe(1);
  });

  test("cross-owner dashboard list never seeds a board; self list still does", async () => {
    const y = `sharing-y-${run}@t.co`;
    await shares.grant(y, doc);
    expect(await dash.list(doc, y)).toEqual([]);
    expect(await new DashboardStore(dbs).list(y)).toEqual([]);
    expect(await dash.list(docB)).toHaveLength(1);
    await dbs.db.delete(schema.dataShares).where(eq(schema.dataShares.ownerEmail, y));
  });
});
