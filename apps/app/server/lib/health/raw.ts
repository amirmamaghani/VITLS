import { fail } from "@agent-native/core/action";
import { getMetric } from "@vitls/health-ingest";
import { and, asc, desc, eq, gte, lt, min } from "drizzle-orm";

import type { MealView } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import type { OwnerScope } from "../ingest/devices";
import { listMeals } from "../meals/meals";
import { rank } from "./read";

export const RAW_SECTIONS = ["sleep", "workouts", "meals"] as const;
type RawSection = (typeof RAW_SECTIONS)[number];
export interface RawQuery { metric?: string; section?: RawSection; before?: string; days?: number }
interface RawSource { id: string; provider: string; via: string; label: string | null }
export type RawRow =
  | { kind: "daily"; day: string; value: number; unit: string; source: RawSource; winner: boolean; updatedAt: string }
  | { kind: "point"; at: string; value: number; unit: string; source: RawSource; winner: boolean; updatedAt: string }
  | { kind: "sleep"; id: string; start: string; end: string; durationS: number; stages: unknown; scores: unknown; source: RawSource; updatedAt: string }
  | { kind: "workout"; id: string; start: string; end: string; type: string; distanceM: number | null; energyKcal: number | null; avgHr: number | null; maxHr: number | null; zones: unknown; sets: unknown; source: RawSource; updatedAt: string }
  | { kind: "meal"; meal: MealView };
export interface RawResult { window: { from: string; to: string }; rows: RawRow[]; sources: RawSource[]; nextBefore: string | null }

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const iso = (value: Date | string) => new Date(value).toISOString();
const json = (value: string | null) => (value ? (JSON.parse(value) as unknown) : null);

/** Unresolved rows for one metric or section, newest first, in a window of `days` ending before `before` (exclusive). */
export async function getHealthRaw(owner: OwnerScope, query: RawQuery): Promise<RawResult> {
  if ((query.metric ? 1 : 0) + (query.section ? 1 : 0) !== 1) fail("Pass exactly one of `metric` or `section`", { statusCode: 400, errorCode: "invalid_query" });
  const def = query.metric ? getMetric(query.metric) : undefined;
  if (query.metric && !def) fail(`Unknown metric: ${query.metric}`, { statusCode: 400, errorCode: "unknown_metric" });
  if (def?.kind === "intraday") fail("Intraday series have no raw view yet", { statusCode: 400, errorCode: "unsupported_metric" });
  const days = Math.min(Math.max(1, Math.floor(query.days ?? 92)), MAX_DAYS);
  const beforeMs = query.before ? Date.parse(`${query.before}T00:00:00Z`) : Date.parse(`${isoDay(Date.now())}T00:00:00Z`) + DAY_MS;
  if (!Number.isFinite(beforeMs)) fail("`before` must be YYYY-MM-DD", { statusCode: 400, errorCode: "invalid_query" });
  const fromMs = beforeMs - days * DAY_MS;
  const window = { from: isoDay(fromMs), to: isoDay(beforeMs - DAY_MS) };
  const beforeDay = isoDay(beforeMs);

  const db = getDb();
  const s = schema.healthSources;
  const sourceRows = await db.select({ id: s.id, provider: s.provider, via: s.via, label: s.label }).from(s).where(eq(s.ownerEmail, owner.userEmail));
  const sourceOf = new Map(sourceRows.map((src) => [src.id, src]));
  const source = (id: string): RawSource => sourceOf.get(id) ?? { id, provider: "unknown", via: "unknown", label: null };
  const used = new Set<string>();
  const rows: RawRow[] = [];
  let nextBefore: string | null = null;
  /** Lowest provider rank wins; rows arrive ordered by source id, so ties resolve to the first id. */
  const winners = <T extends { sourceId: string }>(items: T[], keyOf: (item: T) => string) => {
    const best = new Map<string, string>();
    for (const item of items) {
      const key = keyOf(item);
      const cur = best.get(key);
      if (!cur || rank(source(item.sourceId).provider) < rank(source(cur).provider)) best.set(key, item.sourceId);
    }
    return best;
  };

  if (def?.kind === "daily") {
    const t = schema.dailyMetrics;
    const found = await db
      .select({ day: t.day, value: t.value, unit: t.unit, sourceId: t.sourceId, updatedAt: t.updatedAt })
      .from(t)
      .where(and(eq(t.ownerEmail, owner.userEmail), eq(t.metric, def.key), gte(t.day, window.from), lt(t.day, beforeDay)))
      .orderBy(desc(t.day), asc(t.sourceId));
    const best = winners(found, (r) => r.day);
    for (const r of found) {
      used.add(r.sourceId);
      rows.push({ kind: "daily", day: r.day, value: r.value, unit: r.unit, source: source(r.sourceId), winner: best.get(r.day) === r.sourceId, updatedAt: r.updatedAt });
    }
    const [older] = await db.select({ first: min(t.day) }).from(t).where(and(eq(t.ownerEmail, owner.userEmail), eq(t.metric, def.key), lt(t.day, window.from)));
    nextBefore = older?.first ? window.from : null;
  } else if (def?.kind === "point") {
    const t = schema.pointMetrics;
    const found = await db
      .select({ at: t.at, value: t.value, unit: t.unit, sourceId: t.sourceId, updatedAt: t.updatedAt })
      .from(t)
      .where(and(eq(t.ownerEmail, owner.userEmail), eq(t.metric, def.key), gte(t.at, new Date(fromMs)), lt(t.at, new Date(beforeMs))))
      .orderBy(desc(t.at), asc(t.sourceId));
    const best = winners(found, (r) => iso(r.at));
    for (const r of found) {
      used.add(r.sourceId);
      rows.push({ kind: "point", at: iso(r.at), value: r.value, unit: r.unit, source: source(r.sourceId), winner: best.get(iso(r.at)) === r.sourceId, updatedAt: r.updatedAt });
    }
    const [older] = await db.select({ first: min(t.at) }).from(t).where(and(eq(t.ownerEmail, owner.userEmail), eq(t.metric, def.key), lt(t.at, new Date(fromMs))));
    nextBefore = older?.first ? window.from : null;
  } else if (query.section === "sleep") {
    const t = schema.sleepSessions;
    const found = await db
      .select()
      .from(t)
      .where(and(eq(t.ownerEmail, owner.userEmail), gte(t.startAt, new Date(fromMs)), lt(t.startAt, new Date(beforeMs))))
      .orderBy(desc(t.startAt));
    for (const r of found) {
      used.add(r.sourceId);
      rows.push({ kind: "sleep", id: r.id, start: iso(r.startAt), end: iso(r.endAt), durationS: r.durationS, stages: r.stages, scores: json(r.scores), source: source(r.sourceId), updatedAt: r.updatedAt });
    }
    const [older] = await db.select({ first: min(t.startAt) }).from(t).where(and(eq(t.ownerEmail, owner.userEmail), lt(t.startAt, new Date(fromMs))));
    nextBefore = older?.first ? window.from : null;
  } else if (query.section === "workouts") {
    const t = schema.workouts;
    const found = await db
      .select()
      .from(t)
      .where(and(eq(t.ownerEmail, owner.userEmail), gte(t.startAt, new Date(fromMs)), lt(t.startAt, new Date(beforeMs))))
      .orderBy(desc(t.startAt));
    for (const r of found) {
      used.add(r.sourceId);
      rows.push({
        kind: "workout",
        id: r.id,
        start: iso(r.startAt),
        end: iso(r.endAt),
        type: r.type,
        distanceM: r.distanceM,
        energyKcal: r.energyKcal,
        avgHr: r.avgHr,
        maxHr: r.maxHr,
        zones: json(r.zones),
        sets: r.sets,
        source: source(r.sourceId),
        updatedAt: r.updatedAt,
      });
    }
    const [older] = await db.select({ first: min(t.startAt) }).from(t).where(and(eq(t.ownerEmail, owner.userEmail), lt(t.startAt, new Date(fromMs))));
    nextBefore = older?.first ? window.from : null;
  } else {
    const meals = await listMeals(owner, { from: window.from, to: window.to });
    for (const meal of [...meals].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))) rows.push({ kind: "meal", meal });
    const t = schema.meals;
    const [older] = await db.select({ first: min(t.localDate) }).from(t).where(and(eq(t.ownerEmail, owner.userEmail), lt(t.localDate, window.from)));
    nextBefore = older?.first ? window.from : null;
  }

  return { window, rows, sources: [...used].map(source), nextBefore };
}
