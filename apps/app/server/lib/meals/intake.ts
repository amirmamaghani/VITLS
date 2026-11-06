/**
 * Daily intake = plain daily metrics (intake_<nutrient>) under a per-user "vitls/food" source, recomputed from the
 * day's meals on every write (docs/design/06-nutrition.md §3). Charts, widgets and get-health trends need no new code.
 */
import { randomUUID } from "node:crypto";

import { intakeMetric, NUTRIENTS } from "@vitls/health-ingest";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import { sumNutrients, type Nutrients } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import type { OwnerScope } from "../ingest/devices";

const FOOD = { provider: "vitls", via: "food", deviceTokenId: "food" } as const;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** The per-user food-log source id (created on first use); pass the transaction when inside one. */
export async function foodSourceId(owner: OwnerScope, db: Pick<Tx, "insert" | "select"> = getDb()): Promise<string> {
  await db
    .insert(schema.healthSources)
    .values({ id: randomUUID(), ...FOOD, label: "Food log", createdAt: new Date().toISOString(), ownerEmail: owner.userEmail, orgId: owner.orgId })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: schema.healthSources.id })
    .from(schema.healthSources)
    .where(and(eq(schema.healthSources.ownerEmail, owner.userEmail), eq(schema.healthSources.deviceTokenId, FOOD.deviceTokenId), eq(schema.healthSources.provider, FOOD.provider), eq(schema.healthSources.via, FOOD.via)));
  return row!.id;
}

/** Serializes writers of one owner+day; call inside a transaction, days in sorted order. */
export async function lockIntakeDays(tx: Tx, owner: OwnerScope, days: string[]): Promise<void> {
  for (const day of [...new Set(days)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${owner.userEmail}:${day}`}))`);
}

/** Recomputes one day's intake_* metrics on the given transaction (sourceId from foodSourceId). */
export async function recomputeIntakeDayIn(tx: Tx, owner: OwnerScope, localDate: string, sourceId: string): Promise<Nutrients> {
  const mealIds = (
    await tx
      .select({ id: schema.meals.id })
      .from(schema.meals)
      .where(and(eq(schema.meals.ownerEmail, owner.userEmail), eq(schema.meals.localDate, localDate), eq(schema.meals.source, "vitls")))
  ).map((m) => m.id);
  const items = mealIds.length
    ? await tx.select({ nutrients: schema.mealItems.nutrients }).from(schema.mealItems).where(and(eq(schema.mealItems.ownerEmail, owner.userEmail), inArray(schema.mealItems.mealId, mealIds)))
    : [];
  const totals = sumNutrients(items.map((i) => JSON.parse(i.nutrients) as Nutrients));
  const now = new Date().toISOString();
  await tx
    .delete(schema.dailyMetrics)
    .where(and(eq(schema.dailyMetrics.ownerEmail, owner.userEmail), eq(schema.dailyMetrics.sourceId, sourceId), eq(schema.dailyMetrics.day, localDate), like(schema.dailyMetrics.metric, "intake_%")));
  const rows = NUTRIENTS.flatMap((n) =>
    totals[n.key] === undefined ? [] : [{ sourceId, day: localDate, metric: intakeMetric(n.key), value: totals[n.key]!, unit: n.unit, updatedAt: now, ownerEmail: owner.userEmail, orgId: owner.orgId, visibility: "private" as const }],
  );
  if (rows.length) await tx.insert(schema.dailyMetrics).values(rows);
  return totals;
}

