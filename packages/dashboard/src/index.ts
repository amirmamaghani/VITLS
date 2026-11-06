/**
 * Dashboard config shared by the actions (validation) and /dashboard (rendering). docs/design/04-dashboards.md.
 * Every widget reads through get-health; the agent composes the list (decision D6: no fixed layouts).
 */
import { METRICS } from "@vitls/health-ingest";
import { z } from "zod";

const chartable = METRICS.filter((m) => m.kind !== "intraday").map((m) => m.key) as [string, ...string[]];

/** Time windows every ranged widget offers (the dashboard pill switches between them); a year is read week by week. */
export const RANGES = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;
export type RangeKey = keyof typeof RANGES;
const rangeKey = z.enum(["7d", "30d", "90d", "1y"]);
const range = rangeKey.default("30d");
// id only matters for dashboard ordering; generated when the agent omits it (e.g. show-widget in chat).
const common = { id: z.string().trim().min(1).max(40).default(() => crypto.randomUUID().slice(0, 8)), title: z.string().trim().max(80).optional(), wide: z.boolean().optional() };

export const widgetSchema = z.discriminatedUnion("kind", [
  z
    .object({
    ...common,
    kind: z.literal("metric"),
    metric: z.enum(chartable),
    view: z.enum(["number", "line", "bar", "ring", "trend", "band", "rate"]).default("line"),
    /** Second metric drawn against the first (line view only). */
    compare: z.enum(chartable).optional(),
    range,
    bucket: z.enum(["day", "week", "month"]).optional(),
    /** Ring view: goal in the metric's canonical unit; with `start`, the ring shows the way from start to target. */
    target: z.number().finite().optional(),
    start: z.number().finite().optional(),
    })
    .refine((w) => w.compare !== w.metric, "`compare` must differ from `metric`."),
  z.object({ ...common, kind: z.literal("sleep"), view: z.enum(["duration", "stages"]).default("duration"), range }),
  z.object({ ...common, kind: z.literal("workouts"), range }),
  z.object({ ...common, kind: z.literal("training") }),
  /** Today's protein / carbs / fat split, from the food log's intake metrics. */
  z.object({ ...common, kind: z.literal("macros") }),
  z.object({ ...common, kind: z.literal("readout") }),
  z.object({ ...common, kind: z.literal("water-vs-fat") }),
  z.object({ ...common, kind: z.literal("readiness") }),
  /** Consecutive days a habit held; the "metric" habit needs the metric and a min and/or max threshold. */
  z
    .object({
      ...common,
      kind: z.literal("streak"),
      habit: z.enum(["weigh-in", "workout", "log-food", "metric"]),
      metric: z.enum(chartable).optional(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
    })
    .refine((w) => w.habit !== "metric" || (w.metric !== undefined && (w.min !== undefined || w.max !== undefined)), "A metric streak needs `metric` and `min` or `max`.")
    .refine((w) => w.min === undefined || w.max === undefined || w.min <= w.max, "`min` must not exceed `max`."),
  z.object({ ...common, kind: z.literal("milestone"), label: z.string().trim().min(1).max(60), since: z.iso.date() }),
  z.object({ ...common, kind: z.literal("anomalies"), threshold: z.number().min(1).max(50).default(10) }),
  z.object({ ...common, kind: z.literal("circumferences"), range: rangeKey.default("90d") }),
  z.object({ ...common, kind: z.literal("energy-balance"), range }),
  z.object({ ...common, kind: z.literal("meals") }),
  z.object({ ...common, kind: z.literal("sleep-schedule"), range }),
  z.object({ ...common, kind: z.literal("volume"), sport: z.enum(["run", "ride", "swim", "all"]), range }),
  z.object({ ...common, kind: z.literal("zones"), range }),
  z.object({ ...common, kind: z.literal("long-session"), sport: z.enum(["run", "ride", "swim"]), range }),
  z.object({ ...common, kind: z.literal("swim"), range }),
  z.object({ ...common, kind: z.literal("lift"), exercise: z.string().trim().min(1).max(80), range }),
  z.object({ ...common, kind: z.literal("muscle-volume"), range }),
  z.object({ ...common, kind: z.literal("prs"), range }),
  /** Fixed 12 weeks of training minutes. */
  z.object({ ...common, kind: z.literal("calendar") }),
  z.object({ ...common, kind: z.literal("tdee"), range }),
]);

/** One line per kind / metric view for the coach's tool descriptions (save-dashboard, show-widget). Keep in step with widgetSchema. */
export const WIDGET_CATALOG = `Common fields: id?, title?, wide?, range ("7d"|"30d"|"90d"|"1y") where listed; the user can switch the range on the dashboard.
Dashboard only (save-dashboard, not show-widget): section { kind: "section", title } is a heading that starts a group; put the widgets after it. Group a board into 2–4 sections by goal or theme (e.g. Body, Recovery, Nutrition, Training); at most 20 items in total.
Metric (kind "metric", metric = key e.g. weight, resting_hr, hrv_rmssd_night, steps, vo2max, intake_protein; range, bucket? "day"|"week"|"month"), view:
- number: latest value. line: series (compare? = 2nd metric on the same card; line view only). bar: bucketed bars.
- ring: progress; scores/% need nothing, else target (+ start for a journey like 88 -> 78 kg).
- trend: raw dots + trend line + 30-day mean. band: line with personal normal range (HRV, resting HR, respiration).
- rate: weekly change as % of body weight vs the healthy band (weight / lean mass / muscle mass).
Other kinds:
- readout: today's directive + key numbers (you write it with save-readout; the dashboard header already shows the directive). water-vs-fat: last weigh-in change split fat vs water. readiness: train/easy/rest from HRV, resting HR, sleep.
- streak: habit "weigh-in"|"workout"|"log-food"|"metric" (metric needs metric + min and/or max; e.g. protein >= 175).
- milestone: days since { label, since: YYYY-MM-DD }. anomalies: threshold? (% deviation of today vs baseline, default 10; no range).
- sleep: view "duration"|"stages", range. sleep-schedule: range (bed/wake times). workouts: range. training: today's plan. macros: today's split. meals: today's meals.
- energy-balance: range (intake vs total energy). tdee: range. circumferences: tape measurements, range (default 90d). calendar: 12-week workout heatmap.
- volume: sport "run"|"ride"|"swim"|"all", range. long-session: sport "run"|"ride"|"swim", range. zones: range. swim: range (pace, SWOLF).
- lift: exercise (name), range. muscle-volume: range (weekly sets per muscle). prs: range (best est. 1RM).
Never invent targets, milestone dates or streak thresholds: take them from the user's goals or memory, or ask.
zones, swim (strokes, pool length), lift / muscle-volume / prs (sets) and circumferences need data the user may not have; they show an empty state, so add them only when the data exists or the goal calls for it.`;

/** A heading that starts a new group of widgets on /dashboard; not a widget, so chat (show-widget) never takes one. */
export const sectionSchema = z.object({ id: common.id, kind: z.literal("section"), title: z.string().trim().min(1).max(40) });

export const dashboardConfigSchema = z.object({
  version: z.literal(1).default(1),
  widgets: z
    .array(z.union([sectionSchema, widgetSchema]))
    .max(20)
    .refine((w) => new Set(w.map((x) => x.id)).size === w.length, "Widget ids must be unique."),
});

export type Widget = z.infer<typeof widgetSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
export type DashboardItem = DashboardConfig["widgets"][number];

/** Splits the flat item list at each section heading; widgets before the first heading form an untitled group. */
export function groupSections(items: DashboardItem[]): { section?: Section; widgets: Widget[] }[] {
  const groups: { section?: Section; widgets: Widget[] }[] = [];
  for (const item of items) {
    if (item.kind === "section") groups.push({ section: item, widgets: [] });
    else if (groups.length === 0) groups.push({ widgets: [item] });
    else groups[groups.length - 1]!.widgets.push(item);
  }
  return groups;
}
export const EMPTY_DASHBOARD: DashboardConfig = { version: 1, widgets: [] };

/**
 * How full a ring is: 0–100 scales (score, %) need no target; otherwise latest/target, or the share of the way from
 * `start` to `target` (works for losing and gaining). The arc is capped at a full circle; `pct` keeps the real value.
 */
export function ringProgress(input: { unit?: string; latest: number | null | undefined; target?: number; start?: number }): { fraction: number; pct: number } | null {
  const { unit, latest, target, start } = input;
  if (latest === null || latest === undefined) return null;
  let ratio: number;
  if (target !== undefined && start !== undefined && target !== start) ratio = (latest - start) / (target - start);
  else if (target !== undefined && target !== 0) ratio = latest / target;
  else if (unit === "score" || unit === "pct") ratio = latest / 100;
  else return null;
  return { fraction: Math.min(1, Math.max(0, ratio)), pct: Math.round(ratio * 100) };
}
