import { METRICS } from "@vitls/health-ingest";
import { count, eq, max, min } from "drizzle-orm";

import { getDb, schema } from "../../db";

export interface DataCatalog {
  sources: { id: string; provider: string; via: string; label: string | null; lastSyncAt: string | null; status: string; rows: number }[];
  metrics: { key: string; kind: "daily" | "point" | "intraday"; unit: string; rows: number; firstDay: string | null; lastDay: string | null }[];
  sections: Record<"sleep" | "workouts" | "meals", { rows: number; firstDay: string | null; lastDay: string | null }>;
}

const day = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const earlier = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** Counts behind the Data page: one round trip per table, all scoped by owner. */
export async function getDataCatalog(userEmail: string): Promise<DataCatalog> {
  const db = getDb();
  const s = schema.healthSources;
  const sources = await db
    .select({ id: s.id, provider: s.provider, via: s.via, label: s.label, lastSyncAt: s.lastSyncAt, status: s.status })
    .from(s)
    .where(eq(s.ownerEmail, userEmail));

  const d = schema.dailyMetrics;
  const daily = await db
    .select({ metric: d.metric, sourceId: d.sourceId, rows: count(), first: min(d.day), last: max(d.day) })
    .from(d)
    .where(eq(d.ownerEmail, userEmail))
    .groupBy(d.metric, d.sourceId);
  const p = schema.pointMetrics;
  const points = await db
    .select({ metric: p.metric, sourceId: p.sourceId, rows: count(), first: min(p.at), last: max(p.at) })
    .from(p)
    .where(eq(p.ownerEmail, userEmail))
    .groupBy(p.metric, p.sourceId);
  const i = schema.intradaySeries;
  const intraday = await db
    .select({ metric: i.metric, sourceId: i.sourceId, rows: count(), first: min(i.day), last: max(i.day) })
    .from(i)
    .where(eq(i.ownerEmail, userEmail))
    .groupBy(i.metric, i.sourceId);

  const section = async (t: typeof schema.sleepSessions | typeof schema.workouts) => {
    const [row] = await db.select({ rows: count(), first: min(t.startAt), last: max(t.endAt) }).from(t).where(eq(t.ownerEmail, userEmail));
    const perSource = await db.select({ sourceId: t.sourceId, rows: count() }).from(t).where(eq(t.ownerEmail, userEmail)).groupBy(t.sourceId);
    return { summary: { rows: Number(row?.rows ?? 0), firstDay: day(row?.first), lastDay: day(row?.last) }, perSource };
  };
  const sleep = await section(schema.sleepSessions);
  const workouts = await section(schema.workouts);
  const m = schema.meals;
  const [mealRow] = await db.select({ rows: count(), first: min(m.localDate), last: max(m.localDate) }).from(m).where(eq(m.ownerEmail, userEmail));

  const rowsBySource = new Map<string, number>();
  for (const r of [...daily, ...points, ...intraday, ...sleep.perSource, ...workouts.perSource]) {
    rowsBySource.set(r.sourceId, (rowsBySource.get(r.sourceId) ?? 0) + Number(r.rows));
  }
  const byMetric = new Map<string, { rows: number; first: string | null; last: string | null }>();
  for (const r of [...daily, ...points, ...intraday]) {
    const cur = byMetric.get(r.metric) ?? { rows: 0, first: null, last: null };
    byMetric.set(r.metric, { rows: cur.rows + Number(r.rows), first: earlier(cur.first, day(r.first)), last: later(cur.last, day(r.last)) });
  }

  return {
    sources: sources.map((src) => ({ ...src, rows: rowsBySource.get(src.id) ?? 0 })),
    metrics: METRICS.map((def) => {
      const agg = byMetric.get(def.key);
      return { key: def.key, kind: def.kind, unit: def.unit, rows: agg?.rows ?? 0, firstDay: agg?.first ?? null, lastDay: agg?.last ?? null };
    }),
    sections: {
      sleep: sleep.summary,
      workouts: workouts.summary,
      meals: { rows: Number(mealRow?.rows ?? 0), firstDay: day(mealRow?.first), lastDay: day(mealRow?.last) },
    },
  };
}
