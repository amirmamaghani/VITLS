/**
 * The coach's single read path over health data (docs/design/03-coach.md §6, `get-health`).
 * Values are source-resolved (one value per metric and day), summaries come from @vitls/physiology.
 */
import { HttpException } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import type { DbService } from "../common/db/db.service";
import * as schema from "../db/schema";
import { muscleOf } from "../exercises/exercises";
import type { MealView } from "../meals/meals.schema";

// ESM-only packages: types by import-attribute, values via dynamic import inside getHealth.
type Point = import("@vitls/physiology", { with: { "resolution-mode": "import" } }).Point;
type Summary = ReturnType<typeof import("@vitls/physiology", { with: { "resolution-mode": "import" } }).summarize>;
type GetMetric = typeof import("@vitls/health-ingest", { with: { "resolution-mode": "import" } }).getMetric;
type Db = DbService["db"];

export const HEALTH_SECTIONS = ["daily", "points", "sleep", "workouts", "meals"] as const;
type HealthSection = (typeof HEALTH_SECTIONS)[number];
/** Returned when `include` is omitted; meals are opt-in because they are bulky. */
const DEFAULT_SECTIONS: readonly HealthSection[] = ["daily", "points", "sleep", "workouts"];

/** When two sources report the same metric and day, the first provider in this list wins; manual entry is the fallback. */
const SOURCE_PRIORITY = ["garmin", "oura", "whoop", "polar", "apple_health", "health_connect", "samsung_health", "fitbit", "strava", "manual"];
/** Day-level daily metrics stop at 92 days; bucketed daily metrics and time-stamped rows (points, sleep, workouts) reach a year. */
const MAX_RANGE_DAYS = 92;
const MAX_BUCKETED_RANGE_DAYS = 366;
const SUMMARY_LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;

export const rank = (provider: string) => {
  const i = SOURCE_PRIORITY.indexOf(provider);
  return i === -1 ? SOURCE_PRIORITY.length : i;
};
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const minutes = (ms: number) => Math.round(ms / 60_000);

export const BUCKETS = ["day", "week", "month"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface HealthQuery {
  from: string;
  to: string;
  include?: readonly HealthSection[];
  metrics?: readonly string[];
  /** Aggregate daily metrics per ISO week (Monday) or calendar month using each metric's catalog aggregation. */
  bucket?: Bucket;
  /** Workouts only: keep types containing any of these (case-insensitive substring). */
  workoutTypes?: readonly string[];
}

function bucketStart(day: string, bucket: Bucket): string {
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  if (bucket === "week") {
    const d = new Date(`${day}T00:00:00Z`);
    return isoDay(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  }
  return day;
}

/** Aggregates one metric's daily values into buckets (sum/avg/min/max/last per the metric catalog). */
function aggregate(getMetric: GetMetric, metric: string, values: { date: string; value: number }[], bucket: Bucket) {
  const how = getMetric(metric)?.aggregation ?? "avg";
  const groups = new Map<string, number[]>();
  for (const v of values) {
    const key = bucketStart(v.date, bucket);
    groups.set(key, [...(groups.get(key) ?? []), v.value]);
  }
  return [...groups].map(([date, xs]) => {
    const value =
      how === "sum" ? xs.reduce((a, b) => a + b, 0)
      : how === "min" ? Math.min(...xs)
      : how === "max" ? Math.max(...xs)
      : how === "last" ? xs[xs.length - 1]!
      : xs.reduce((a, b) => a + b, 0) / xs.length;
    return { date, value: Math.round(value * 100) / 100, days: xs.length };
  });
}

export type ListMeals = (ownerEmail: string, range: { from: string; to: string }) => Promise<MealView[]>;

export async function getHealth(db: Db, listMeals: ListMeals, ownerEmail: string, query: HealthQuery) {
  const { getMetric } = await import("@vitls/health-ingest");
  const { fatChangeCheck, summarize } = await import("@vitls/physiology");
  const fromMs = Date.parse(`${query.from}T00:00:00Z`);
  const toMs = Date.parse(`${query.to}T23:59:59Z`);
  if (!(toMs >= fromMs)) throw new HttpException({ error: "`to` must not be before `from`", errorCode: "invalid_range" }, 400);
  const include = new Set(query.include ?? DEFAULT_SECTIONS);
  const maxDays = include.has("daily") && (!query.bucket || query.bucket === "day") ? MAX_RANGE_DAYS : MAX_BUCKETED_RANGE_DAYS;
  if (toMs - fromMs > maxDays * DAY_MS) throw new HttpException({ error: `Range is limited to ${maxDays} days`, errorCode: "range_too_large" }, 400);
  const lookbackFrom = isoDay(Math.min(fromMs, toMs - SUMMARY_LOOKBACK_DAYS * DAY_MS));
  const sources = await db
    .select({ id: schema.healthSources.id, provider: schema.healthSources.provider, lastSyncAt: schema.healthSources.lastSyncAt })
    .from(schema.healthSources)
    .where(eq(schema.healthSources.ownerEmail, ownerEmail));
  const providerOf = new Map(sources.map((s) => [s.id, s.provider]));
  /** The same session re-sent by another source (a phone paired twice, or two apps syncing one watch): keep the best-ranked copy. */
  const dedupe = <T extends { sourceId: string }>(rows: T[], keyOf: (row: T) => string) => {
    const best = new Map<string, T>();
    for (const row of rows) {
      const key = keyOf(row);
      const seen = best.get(key);
      const [mine, theirs] = [rank(providerOf.get(row.sourceId) ?? "unknown"), seen ? rank(providerOf.get(seen.sourceId) ?? "unknown") : Infinity];
      if (!seen || mine < theirs || (mine === theirs && row.sourceId < seen.sourceId)) best.set(key, row);
    }
    return [...best.values()];
  };

  const result: {
    range: { from: string; to: string };
    sources: { provider: string; lastSyncAt: string | null }[];
    daily?: Record<string, { values: (Point & { source: string })[]; summary: Summary; buckets?: Array<{ date: string; value: number; days: number }> }>;
    points?: Record<string, { values: { at: string; value: number; source: string }[]; summary: Summary; lastChange?: unknown }>;
    sleep?: unknown[];
    workouts?: unknown[];
    meals?: MealView[];
  } = { range: { from: query.from, to: query.to }, sources: sources.map(({ provider, lastSyncAt }) => ({ provider, lastSyncAt })) };

  if (include.has("daily")) {
    const t = schema.dailyMetrics;
    const rows = await db
      .select({ date: t.day, metric: t.metric, value: t.value, sourceId: t.sourceId })
      .from(t)
      .where(and(eq(t.ownerEmail, ownerEmail), gte(t.day, lookbackFrom), lte(t.day, query.to), ...(query.metrics?.length ? [inArray(t.metric, [...query.metrics])] : [])))
      // Source id breaks provider ties, the same rule the Data page's raw view uses to mark the winner.
      .orderBy(asc(t.day), asc(t.sourceId));
    const best = new Map<string, { date: string; metric: string; value: number; source: string }>();
    for (const r of rows) {
      const source = providerOf.get(r.sourceId) ?? "unknown";
      const key = `${r.metric}|${r.date}`;
      const current = best.get(key);
      if (!current || rank(source) < rank(current.source)) best.set(key, { date: r.date, metric: r.metric, value: r.value, source });
    }
    result.daily = {};
    for (const r of best.values()) {
      const entry = (result.daily[r.metric] ??= { values: [], summary: summarize([]) });
      entry.values.push({ date: r.date, value: r.value, source: r.source });
    }
    for (const [metric, entry] of Object.entries(result.daily)) {
      entry.values.sort((a, b) => a.date.localeCompare(b.date));
      entry.summary = summarize(entry.values);
      entry.values = entry.values.filter((v) => v.date >= query.from);
      if (query.bucket && query.bucket !== "day") {
        // Bucketed view replaces the per-day list to keep results small.
        entry.buckets = aggregate(getMetric, metric, entry.values, query.bucket);
        entry.values = [];
      }
    }
  }

  if (include.has("points")) {
    const t = schema.pointMetrics;
    const rows = await db
      .select({ at: t.at, metric: t.metric, value: t.value, sourceId: t.sourceId })
      .from(t)
      .where(and(eq(t.ownerEmail, ownerEmail), gte(t.at, new Date(`${lookbackFrom}T00:00:00Z`)), lte(t.at, new Date(toMs)), ...(query.metrics?.length ? [inArray(t.metric, [...query.metrics])] : [])))
      .orderBy(asc(t.at));
    result.points = {};
    for (const r of rows) {
      const entry = (result.points[r.metric] ??= { values: [], summary: summarize([]) });
      entry.values.push({ at: r.at.toISOString(), value: r.value, source: providerOf.get(r.sourceId) ?? "unknown" });
    }
    for (const [metric, entry] of Object.entries(result.points)) {
      // Daily series for trends: the last reading of each day.
      const perDay = new Map(entry.values.map((v) => [v.at.slice(0, 10), v.value]));
      entry.summary = summarize([...perDay].map(([date, value]) => ({ date, value })));
      const [prev, last] = entry.values.slice(-2);
      if (metric === "weight" && prev && last) {
        const deltaKg = Math.round((last.value - prev.value) * 100) / 100;
        const days = Math.max((Date.parse(last.at) - Date.parse(prev.at)) / DAY_MS, 1 / 24);
        entry.lastChange = { from: prev.at, to: last.at, deltaKg, check: fatChangeCheck(deltaKg, Math.ceil(days)) };
      }
      entry.values = entry.values.filter((v) => v.at >= `${query.from}T00:00:00`);
    }
  }

  if (include.has("sleep")) {
    const t = schema.sleepSessions;
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.ownerEmail, ownerEmail), gte(t.endAt, new Date(fromMs)), lte(t.startAt, new Date(toMs))))
      .orderBy(asc(t.startAt));
    result.sleep = dedupe(rows, (s) => `${s.startAt.toISOString()}/${s.endAt.toISOString()}`).map((s) => ({
      start: s.startAt.toISOString(),
      end: s.endAt.toISOString(),
      durationMin: minutes(s.endAt.getTime() - s.startAt.getTime()),
      stageMinutes: (s.stages ?? []).reduce<Record<string, number>>((acc, st) => {
        acc[st.stage] = (acc[st.stage] ?? 0) + minutes(Date.parse(st.end) - Date.parse(st.start));
        return acc;
      }, {}),
      scores: s.scores ? JSON.parse(s.scores) : undefined,
      source: providerOf.get(s.sourceId) ?? "unknown",
    }));
  }

  if (include.has("workouts")) {
    const t = schema.workouts;
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.ownerEmail, ownerEmail), gte(t.startAt, new Date(fromMs)), lte(t.startAt, new Date(toMs))))
      .orderBy(asc(t.startAt));
    const wanted = query.workoutTypes?.map((x) => x.toLowerCase()).filter(Boolean);
    result.workouts = dedupe(rows, (w) => `${w.type.toLowerCase()}/${w.startAt.toISOString()}/${w.endAt.toISOString()}`)
      .filter((w) => !wanted?.length || wanted.some((x) => w.type.toLowerCase().includes(x)))
      .map((w) => ({
        type: w.type,
        start: w.startAt.toISOString(),
        durationMin: minutes(w.endAt.getTime() - w.startAt.getTime()),
        distanceM: w.distanceM ?? undefined,
        energyKcal: w.energyKcal ?? undefined,
        avgHr: w.avgHr ?? undefined,
        maxHr: w.maxHr ?? undefined,
        poolLengthM: w.poolLengthM ?? undefined,
        strokes: w.strokes ?? undefined,
        zones: w.zones ? JSON.parse(w.zones) : undefined,
        sets: w.sets?.map((s) => ({ ...s, muscle: muscleOf(s.exercise) })),
        source: providerOf.get(w.sourceId) ?? "unknown",
      }));
  }

  if (include.has("meals")) {
    result.meals = await listMeals(ownerEmail, { from: query.from, to: query.to });
  }

  return result;
}
