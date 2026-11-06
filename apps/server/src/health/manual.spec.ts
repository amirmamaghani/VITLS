import { randomBytes } from "node:crypto";

import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import * as schema from "../db/schema";
import { IngestService } from "../ingest/ingest.service";
import { FoodsService } from "../meals/foods.service";
import { MealsService } from "../meals/meals.service";
import { HealthService } from "./health.service";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.VITLS_FIELD_KEYS ??= `k1:${randomBytes(32).toString("base64")}`;

describe("HealthService.logManual", () => {
  const db = new DbService();
  const settings = new SettingsService(db);
  const svc = new HealthService(db, new MealsService(db, settings, new FoodsService(db)), new IngestService(db), settings);
  const owner = "manual-log@t.co";

  afterAll(async () => {
    for (const t of [schema.pointMetrics, schema.dailyMetrics, schema.workouts, schema.ingestBatches, schema.healthSources]) await db.db.delete(t).where(eq(t.ownerEmail, owner));
    await db.onModuleDestroy();
  });

  it("stores weight entries as point metrics under the manual source", async () => {
    const r = await svc.logManual(owner, { entries: [{ metric: "weight", value: 80, date: "2026-10-01" }, { metric: "weight", value: 79.5, date: "2026-10-02" }] });
    expect(r).toEqual({ stored: 2 });
    const rows = await db.db.select().from(schema.pointMetrics).where(eq(schema.pointMetrics.ownerEmail, owner));
    const [src] = await db.db.select().from(schema.healthSources).where(eq(schema.healthSources.ownerEmail, owner));
    expect(src!.provider).toBe("manual");
    expect(rows.filter((x) => x.metric === "weight" && x.sourceId === src!.id)).toHaveLength(2);
  });

  it("rejects intake_* metrics", async () => {
    await expect(svc.logManual(owner, { entries: [{ metric: "intake_protein", value: 30 }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects more than 50 entries", async () => {
    const entries = Array.from({ length: 51 }, () => ({ metric: "weight", value: 80 }));
    await expect(svc.logManual(owner, { entries })).rejects.toBeInstanceOf(BadRequestException);
  });
});
