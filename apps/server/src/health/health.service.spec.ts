import { randomBytes } from "node:crypto";

import { BadRequestException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { runWithOwner } from "../common/field-crypto-context";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import * as schema from "../db/schema";
import { IngestService } from "../ingest/ingest.service";
import { FoodsService } from "../meals/foods.service";
import { MealsService } from "../meals/meals.service";
import { HealthReadController } from "./health.controller";
import { HealthService } from "./health.service";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;

describe("HealthService", () => {
  const db = new DbService();
  const meals = new MealsService(db, new SettingsService(db), new FoodsService(db));
  const svc = new HealthService(db, meals, new IngestService(db), new SettingsService(db));
  const owner = "health-read@t.co";
  const [garmin, manual] = ["hr-garmin", "hr-manual"];
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const now = new Date().toISOString();

  beforeAll(async () => {
    await db.db.insert(schema.healthSources).values([
      { id: garmin, provider: "garmin", via: "companion", deviceTokenId: "t1", createdAt: now, ownerEmail: owner },
      { id: manual, provider: "manual", via: "manual", deviceTokenId: "t2", createdAt: now, ownerEmail: owner },
    ]);
    await db.db.insert(schema.dailyMetrics).values(
      days.flatMap((day, i) => [
        { sourceId: garmin, day, metric: "steps", value: 1000 * (i + 1), unit: "count", updatedAt: now, ownerEmail: owner },
        { sourceId: manual, day, metric: "steps", value: 1, unit: "count", updatedAt: now, ownerEmail: owner },
      ]),
    );
  });

  afterAll(async () => {
    const m = await db.db.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.ownerEmail, owner));
    for (const { id } of m) await db.db.delete(schema.mealItems).where(eq(schema.mealItems.mealId, id));
    for (const t of [schema.meals, schema.sleepSessions, schema.workouts, schema.dailyMetrics, schema.healthSources]) await db.db.delete(t).where(eq(t.ownerEmail, owner));
    await db.onModuleDestroy();
  });

  it("getHealth daily returns source-resolved values and a summary", async () => {
    const r = await svc.getHealth(owner, { from: days[0]!, to: days[2]!, include: ["daily"] });
    expect(r.daily!.steps!.values.map((v) => [v.date, v.value, v.source])).toEqual([
      ["2026-10-01", 1000, "garmin"],
      ["2026-10-02", 2000, "garmin"],
      ["2026-10-03", 3000, "garmin"],
    ]);
    expect(r.daily!.steps!.summary).toBeDefined();
  });

  it("rejects a day-level range beyond 92 days", async () => {
    await expect(svc.getHealth(owner, { from: "2026-01-01", to: "2026-10-01", include: ["daily"] })).rejects.toMatchObject({ response: { errorCode: "range_too_large" } });
    await expect(svc.getHealth(owner, { from: "2026-01-01", to: "2026-10-01", include: ["daily"], bucket: "month" })).resolves.toBeDefined();
  });

  it("getHealthRaw marks exactly one winner per day (highest source priority)", async () => {
    const r = await svc.getHealthRaw(owner, { metric: "steps", before: "2026-10-04", days: 10 });
    expect(r.rows).toHaveLength(6);
    for (const day of days) {
      const winners = r.rows.filter((x) => x.kind === "daily" && x.day === day && x.winner);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({ source: { provider: "garmin" } });
    }
  });

  it("getDataCatalog has one entry per catalog metric with row counts", async () => {
    const { METRICS } = await import("@vitls/health-ingest");
    const c = await svc.getDataCatalog(owner);
    expect(c.metrics).toHaveLength(METRICS.length);
    expect(c.metrics.find((m) => m.key === "steps")).toMatchObject({ rows: 6, firstDay: "2026-10-01", lastDay: "2026-10-03" });
    expect(c.sources.find((s) => s.id === garmin)?.rows).toBe(3);
  });

  it("maps range/validation failures to {error, errorCode} at 400", async () => {
    const err = await svc.getHealth(owner, { from: "2026-10-03", to: "2026-10-01" }).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({ error: "`to` must not be before `from`", errorCode: "invalid_range" });
  });

  it("decrypts sleep stages, workout sets and meals inside the owner context", async () => {
    const start = new Date("2026-10-02T22:00:00Z");
    const end = new Date("2026-10-03T06:00:00Z");
    await runWithOwner(owner, async () => {
      await db.db.insert(schema.sleepSessions).values({
        id: "hr-sleep", sourceId: garmin, externalId: "s1", startAt: start, endAt: end, durationS: 28800,
        stages: [{ stage: "deep", start: start.toISOString(), end: new Date(start.getTime() + 90 * 60_000).toISOString() }],
        updatedAt: now, ownerEmail: owner,
      });
      await db.db.insert(schema.workouts).values({
        id: "hr-workout", sourceId: garmin, externalId: "w1", type: "strength", startAt: new Date("2026-10-02T10:00:00Z"), endAt: new Date("2026-10-02T11:00:00Z"),
        sets: [{ exercise: "Bench Press", reps: 5, weightKg: 80 }], updatedAt: now, ownerEmail: owner,
      });
    });
    await meals.logMeal(owner, { eatenAt: "2026-10-02T12:00:00Z", note: "secret lunch", items: [{ name: "Secret Stew", amount: 100, unit: "g", nutrients: { energy: 150 } }] });

    const raw = await db.db.execute(sql`select stages::text as s from sleep_sessions where id = 'hr-sleep'`);
    expect(JSON.stringify(raw)).not.toContain("deep");

    const r = await svc.getHealth(owner, { from: "2026-10-01", to: "2026-10-03", include: ["sleep", "workouts", "meals"] });
    expect(r.sleep).toMatchObject([{ durationMin: 480, stageMinutes: { deep: 90 } }]);
    expect(r.workouts).toMatchObject([{ type: "strength", sets: [{ exercise: "Bench Press", reps: 5, weightKg: 80 }] }]);
    expect(r.meals).toMatchObject([{ note: "secret lunch", items: [{ name: "Secret Stew" }] }]);
  });

  it("controller coerces query strings", async () => {
    const calls: unknown[] = [];
    const ctrl = new HealthReadController({ getHealth: async (_o: string, q: unknown) => calls.push(q), getHealthRaw: async (_o: string, q: unknown) => calls.push(q) } as unknown as HealthService, { resolveReadOwner: async (u: string) => u } as never);
    await ctrl.get(owner, { from: "2026-10-01", to: "2026-10-03", include: "daily,sleep", bucket: "week" });
    await ctrl.raw(owner, { metric: "steps", days: "10" });
    expect(calls).toEqual([{ from: "2026-10-01", to: "2026-10-03", include: ["daily", "sleep"], bucket: "week" }, { metric: "steps", days: 10 }]);
  });
});
