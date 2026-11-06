import { and, eq, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { updateCoachProfile } from "../coach/profile";
import { getHealth } from "../health/read";
import { logManual } from "../ingest/manual";
import { upsertFoods } from "../foods/store";
import { nutrientsSchema } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import { setupTestDb } from "../../test/db";
import { deleteMeal, listMeals, logMeal } from "./meals";

const mia = { userEmail: "mia@example.com", orgId: "org_mia" };
const eve = { userEmail: "eve@example.com", orgId: "org_eve" };
let eggId = "";
let oilId = "";

const intake = async (owner: typeof mia, day: string) =>
  (await getHealth(owner.userEmail, { from: day, to: day, include: ["daily"] })).daily ?? {};

describe("meals", () => {
  beforeAll(async () => {
    await setupTestDb();
    await updateCoachProfile(mia.userEmail, { timezone: "Europe/Prague" });
    const { ids } = await upsertFoods([
      { source: "usda", sourceRef: "egg", name: "Egg, whole", basis: "100g", nutrients: { energy: 143, protein: 12.6, fat: 9.5 }, portions: [{ label: "1 large", amount: 50 }] },
      { source: "usda", sourceRef: "oil", name: "Olive oil", basis: "100ml", nutrients: { energy: 824, fat: 91.6 } },
    ]);
    [eggId, oilId] = ids as [string, string];
  });

  it("logs items from grams and portions with snapshots and day totals", async () => {
    const meal = await logMeal(mia, {
      eatenAt: "2026-10-05T07:30:00+02:00",
      mealType: "breakfast",
      items: [
        { foodId: eggId, amount: 2, portion: "1 large" },
        { foodId: oilId, amount: 10, unit: "ml" },
        { name: "Toast", amount: 30, unit: "g", nutrients: { energy: 80, protein: 3, carbs: 15 }, estimated: true },
      ],
    });
    expect(meal.localDate).toBe("2026-10-05");
    expect(meal.items.map((i) => [i.amount, i.unit])).toEqual([[100, "g"], [10, "ml"], [30, "g"]]);
    expect(meal.totals.protein).toBeCloseTo(15.6);
    expect(meal.totals.energy).toBeCloseTo(143 + 82.4 + 80);
    const daily = await intake(mia, "2026-10-05");
    expect(daily.intake_protein?.values[0]).toMatchObject({ date: "2026-10-05", source: "vitls" });
    expect(daily.intake_protein?.values[0]?.value).toBeCloseTo(15.6);
  });

  it("puts a meal at 00:30 local time on that local day (Review Focus 1)", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-06T00:30:00+02:00", items: [{ foodId: eggId, amount: 50 }] });
    expect(meal.localDate).toBe("2026-10-06");
  });

  it("keeps the snapshot when the reference food changes", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-04T12:00:00Z", items: [{ foodId: eggId, amount: 100 }] });
    await upsertFoods([{ source: "usda", sourceRef: "egg", name: "Egg, whole", basis: "100g", nutrients: { energy: 999, protein: 99 } }]);
    const [again] = await listMeals(mia, { from: "2026-10-04", to: "2026-10-04" });
    expect(again?.items[0]?.nutrients.protein).toBeCloseTo(12.6);
    expect(again?.id).toBe(meal.id);
  });

  it("recomputes both days when a meal moves and after delete (Review Focus 2)", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-01T12:00:00Z", items: [{ name: "Skyr", amount: 150, unit: "g", nutrients: { protein: 16 } }] });
    await logMeal(mia, { mealId: meal.id, eatenAt: "2026-10-02T12:00:00Z" });
    expect((await intake(mia, "2026-10-01")).intake_protein).toBeUndefined();
    expect((await intake(mia, "2026-10-02")).intake_protein?.values[0]?.value).toBe(16);
    await deleteMeal(mia, meal.id);
    expect((await intake(mia, "2026-10-02")).intake_protein).toBeUndefined();
  });

  it("never produces NaN when a food lacks a nutrient (Review Focus 3)", async () => {
    await logMeal(mia, { eatenAt: "2026-09-30T12:00:00Z", items: [{ foodId: oilId, amount: 10, unit: "ml" }, { name: "Apple", amount: 150, unit: "g", nutrients: { fiber: 3.6 } }] });
    const daily = await intake(mia, "2026-09-30");
    expect(daily.intake_fiber?.values[0]?.value).toBe(3.6);
    expect(daily.intake_fat?.values[0]?.value).toBeCloseTo(9.16);
    for (const entry of Object.values(daily)) for (const v of entry.values) expect(Number.isNaN(v.value)).toBe(false);
  });

  it("rejects unit mismatches and unknown portions without writing (Review Focus 4)", async () => {
    await expect(logMeal(mia, { eatenAt: "2026-09-29T12:00:00Z", items: [{ foodId: eggId, amount: 100, unit: "ml" }] })).rejects.toThrow(/Egg, whole.*per 100 g/);
    await expect(logMeal(mia, { eatenAt: "2026-09-29T12:00:00Z", items: [{ foodId: eggId, amount: 1, portion: "1 cup" }] })).rejects.toThrow(/portion "1 cup"/);
    expect(await listMeals(mia, { from: "2026-09-29", to: "2026-09-29" })).toEqual([]);
  });

  it("copies a meal to now and isolates owners", async () => {
    const [source] = await listMeals(mia, { from: "2026-10-05", to: "2026-10-05" });
    const copy = await logMeal(mia, { fromMealId: source!.id, eatenAt: "2026-10-07T07:30:00+02:00" });
    expect(copy).toMatchObject({ entry: "copy", localDate: "2026-10-07" });
    expect(copy.items).toHaveLength(3);
    await expect(logMeal(eve, { mealId: source!.id, note: "mine" })).rejects.toThrow(/not found/i);
    await expect(logMeal(eve, { fromMealId: source!.id })).rejects.toThrow(/not found/i);
    expect(await deleteMeal(eve, source!.id)).toEqual({ deleted: false });
  });

  it("sums concurrent logs on the same day", async () => {
    const day = "2026-09-20";
    await Promise.all([
      logMeal(mia, { eatenAt: `${day}T10:00:00Z`, items: [{ name: "A", amount: 100, unit: "g", nutrients: { protein: 10 } }] }),
      logMeal(mia, { eatenAt: `${day}T11:00:00Z`, items: [{ name: "B", amount: 100, unit: "g", nutrients: { protein: 5 } }] }),
    ]);
    expect((await intake(mia, day)).intake_protein?.values[0]?.value).toBe(15);
  });

  it("falls back to UTC for an invalid timezone and for a user without one", async () => {
    const zoe = { userEmail: "zoe@example.com", orgId: "org_zoe" };
    const item = [{ name: "X", amount: 10, unit: "g" as const, nutrients: { protein: 1 } }];
    expect((await logMeal(zoe, { eatenAt: "2026-09-10T23:30:00-05:00", items: item })).localDate).toBe("2026-09-11");
    await updateCoachProfile(zoe.userEmail, { timezone: "Europe/Bratisalva" });
    expect((await logMeal(zoe, { eatenAt: "2026-09-10T23:30:00-05:00", items: item })).localDate).toBe("2026-09-11");
  });

  it("leaves other sources' and owners' intake rows untouched", async () => {
    const day = "2026-09-15";
    const db = getDb();
    const mk = (owner: typeof mia, id: string) => ({ id, provider: "apple", via: "ios", deviceTokenId: `tok_${id}`, label: id, createdAt: "2026-09-01T00:00:00Z", ownerEmail: owner.userEmail, orgId: owner.orgId });
    await db.insert(schema.healthSources).values([mk(mia, "src_dev_mia"), mk(eve, "src_dev_eve")]);
    const row = (owner: typeof mia, sourceId: string) => ({ sourceId, day, metric: "intake_protein", value: 42, unit: "g", updatedAt: "2026-09-15T00:00:00Z", ownerEmail: owner.userEmail, orgId: owner.orgId, visibility: "private" as const });
    await db.insert(schema.dailyMetrics).values([row(mia, "src_dev_mia"), row(eve, "src_dev_eve")]);
    const meal = await logMeal(mia, { eatenAt: `${day}T12:00:00Z`, items: [{ name: "Y", amount: 10, unit: "g", nutrients: { protein: 1 } }] });
    await deleteMeal(mia, meal.id);
    const rows = await db.select().from(schema.dailyMetrics).where(and(eq(schema.dailyMetrics.day, day), like(schema.dailyMetrics.metric, "intake_%")));
    expect(rows.map((r) => [r.sourceId, r.value]).sort()).toEqual([["src_dev_eve", 42], ["src_dev_mia", 42]]);
  });

  it("rejects a manual intake value, so it can never hide the food log (final review 1)", async () => {
    const day = "2026-09-12";
    await logMeal(mia, { eatenAt: `${day}T12:00:00Z`, items: [{ name: "Skyr", amount: 150, unit: "g", nutrients: { protein: 16 } }] });
    await expect(logManual(mia, { entries: [{ metric: "intake_protein", value: 200, when: day }] })).rejects.toThrow(/food log/);
    expect((await intake(mia, day)).intake_protein?.values).toEqual([{ date: day, value: 16, source: "vitls" }]);
  });

  it("answers 404 for an update of a meal deleted meanwhile, without orphan items (final review 3)", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-09-13T12:00:00Z", items: [{ name: "Z", amount: 10, unit: "g", nutrients: { protein: 1 } }] });
    await deleteMeal(mia, meal.id);
    await expect(logMeal(mia, { mealId: meal.id, items: [{ name: "Z", amount: 20, unit: "g", nutrients: { protein: 2 } }] })).rejects.toMatchObject({ message: "Meal not found", statusCode: 404 });
    expect(await getDb().select().from(schema.mealItems).where(eq(schema.mealItems.mealId, meal.id))).toEqual([]);
    expect(await deleteMeal(mia, meal.id)).toEqual({ deleted: false });
  });

  it("bounds nutrient values in the log-meal and create-food schemas (final review 9)", () => {
    const bounded = nutrientsSchema("test");
    expect(bounded.safeParse({ energy: 20_000, protein: 100_000 }).success).toBe(true);
    expect(bounded.safeParse({ energy: 20_001 }).success).toBe(false);
    expect(bounded.safeParse({ sodium: 1e9 }).success).toBe(false);
  });
});
