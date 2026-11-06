import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useChangeVersion } from "@agent-native/core/client/use-change-version";
import { IconActivity, IconAlertTriangle, IconBarbell, IconBike, IconBolt, IconCalendar, IconDroplet, IconFlag, IconFlame, IconHeartbeat, IconLungs, IconMoon, IconRun, IconRuler, IconScale, IconSun, IconSwimming, IconTrophy, IconToolsKitchen2, IconWalk, type Icon } from "@tabler/icons-react";
import { getMetric } from "@vitls/health-ingest";
import { useEffect, type ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { Readout } from "../../../server/lib/coach/readout";
import { RANGES, type RangeKey, type Widget } from "../../../shared/dashboard";
import { BAND_WINDOW_DAYS, dayOf, rangeOf, SPORT_TYPES } from "../../../shared/widget-data";
import { IconBadge, Pill, statusOf, WidgetMenu, type HealthResult } from "./blocks";
import { AnomaliesBody, MilestoneBody, ReadinessBody, ReadoutBody, STREAK_DAYS, StreakBody, useUserTimeZone, WATER_DAYS, WaterVsFatBody } from "./coach";
import { CircumferencesBody, CIRCUMFERENCE_METRICS, EnergyBalanceBody } from "./body";
import { CalendarBody, TdeeBody } from "./activity";
import { LongSessionBody, SwimBody, VolumeBody, ZonesBody } from "./endurance";
import { LiftBody, MuscleVolumeBody, PrsBody } from "./strength";
import { MacrosBody, MACRO_METRICS } from "./macros";
import { MetricBody } from "./metric";
import { MealsBody } from "./nutrition";
import { SleepBody, SleepScheduleBody } from "./sleep";
import { TrainingBody, type Session } from "./training";
import { WorkoutsBody } from "./workouts";

export { Figure, formatParts, IconBadge, Pill, type HealthResult } from "./blocks";
export type { Session } from "./training";

const METRIC_ICONS: [RegExp, Icon][] = [
  [/^intake_water/, IconDroplet],
  [/^intake_/, IconToolsKitchen2],
  [/weight|body_fat|muscle|body_water/, IconScale],
  [/waist/, IconRuler],
  [/sleep/, IconMoon],
  [/hr|blood_pressure|heart/, IconHeartbeat],
  [/spo2|respiration|vo2max/, IconLungs],
  [/steps|distance|floors/, IconWalk],
  [/energy/, IconFlame],
  [/battery|readiness|stress/, IconBolt],
];

const RANGE_LABEL: Record<RangeKey, string> = { "7d": "widgets.range.7d", "30d": "widgets.range.30d", "90d": "widgets.range.90d", "1y": "widgets.range.1y" };
/** The band view's personal range is computed day by day, so it stops at 90 days (a year is read in weekly buckets). */
const rangeOptions = (w: Widget): RangeKey[] => (Object.keys(RANGES) as RangeKey[]).filter((r) => r !== "1y" || !(w.kind === "metric" && w.view === "band"));
const hasRange = (w: Widget): w is Widget & { range: RangeKey } => "range" in w;

/** The range pill as a picker (Select: chevron, check mark, keyboard) where the dashboard can save the choice; a plain pill elsewhere (chat). */
function RangePill({ widget, onRange }: { widget: Widget & { range: RangeKey }; onRange: (range: RangeKey) => void }) {
  const t = useT();
  return (
    <Select value={widget.range} onValueChange={(r) => onRange(r as RangeKey)}>
      <SelectTrigger size="sm" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto w-auto shrink-0 justify-between rounded-full py-1 pe-2 font-normal tabular-nums")} aria-label={t("widgets.range.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {rangeOptions(widget).map((r) => (
          <SelectItem key={r} value={r}>
            {t(RANGE_LABEL[r])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;
type MetaOf<K extends WidgetKind> = {
  /** The default title: a catalog key, or a function of the widget and the translator. */
  title: string | ((w: Extract<Widget, { kind: K }>, t: T) => string);
  icon?: Icon;
  iconOf?: (w: Extract<Widget, { kind: K }>) => Icon | undefined;
  /** The right-hand pill: null = none, undefined = the range picker. */
  pill?: (w: Extract<Widget, { kind: K }>, t: T) => string | null;
};

const today = (_w: unknown, t: T) => t("widgets.pill.today");

/** Header per widget kind: the default title, the icon and the right-hand pill (null = none; default = the range). A new kind adds an entry here, in BODIES and in PARAMS. */
const META: { [K in WidgetKind]: MetaOf<K> } = {
  // The coach's metric title falls back to the catalog description ("Resting heart rate"), never the raw key.
  metric: {
    title: (w) => getMetric(w.metric)?.description ?? w.metric.replace(/_/g, " "),
    iconOf: (w) => METRIC_ICONS.find(([re]) => re.test(w.metric))?.[1],
  },
  sleep: { title: "widgets.title.sleep", icon: IconMoon },
  workouts: { title: "widgets.title.workouts", icon: IconRun },
  training: { title: "widgets.title.training", icon: IconBarbell },
  macros: { title: "widgets.title.macros", icon: IconToolsKitchen2, pill: today },
  readout: { title: "widgets.title.readout", icon: IconSun, pill: () => null },
  "water-vs-fat": { title: "widgets.title.waterVsFat", icon: IconDroplet, pill: (_w, t) => t("widgets.pill.days", { count: WATER_DAYS }) },
  readiness: { title: "widgets.title.readiness", icon: IconBolt, pill: today },
  streak: { title: "widgets.title.streak", icon: IconFlame },
  milestone: { title: "widgets.title.milestone", icon: IconFlag },
  anomalies: { title: "widgets.title.anomalies", icon: IconAlertTriangle, pill: (_w, t) => t("widgets.pill.days", { count: 7 }) },
  circumferences: { title: "widgets.title.circumferences", icon: IconRuler },
  "energy-balance": { title: "widgets.title.energyBalance", icon: IconFlame },
  meals: { title: "widgets.title.meals", icon: IconToolsKitchen2, pill: today },
  "sleep-schedule": { title: "widgets.title.sleepSchedule", icon: IconMoon },
  volume: { title: (w, t) => t(`widgets.title.volume.${w.sport}`), iconOf: (w) => (w.sport === "ride" ? IconBike : w.sport === "swim" ? IconSwimming : IconRun) },
  zones: { title: "widgets.title.zones", icon: IconHeartbeat },
  "long-session": { title: (w, t) => t(`widgets.title.longSession.${w.sport}`), iconOf: (w) => (w.sport === "ride" ? IconBike : w.sport === "swim" ? IconSwimming : IconRun) },
  swim: { title: "widgets.title.swim", icon: IconSwimming },
  lift: { title: (w) => w.exercise.replace(/_/g, " "), icon: IconBarbell },
  "muscle-volume": { title: "widgets.title.muscleVolume", icon: IconBarbell },
  prs: { title: "widgets.title.prs", icon: IconTrophy },
  calendar: { title: "widgets.title.calendar", icon: IconCalendar, pill: (_w, t) => t("widgets.pill.weeks", { count: 12 }) },
  tdee: { title: "widgets.title.tdee", icon: IconFlame },
};

/** The one place the per-kind entry is widened to the full widget union (each entry is checked against its own kind above). */
const metaOf = (w: Widget) => META[w.kind] as unknown as MetaOf<WidgetKind> & { title: string | ((w: Widget, t: T) => string); iconOf?: (w: Widget) => Icon | undefined; pill?: (w: Widget, t: T) => string | null };
const titleFor = (w: Widget, t: T) => w.title ?? (typeof metaOf(w).title === "function" ? (metaOf(w).title as (w: Widget, t: T) => string)(w, t) : t(metaOf(w).title as string));
const iconFor = (w: Widget): Icon => metaOf(w).iconOf?.(w) ?? metaOf(w).icon ?? IconActivity;
const pillFor = (w: Widget, t: T) => (metaOf(w).pill ? metaOf(w).pill!(w, t) : hasRange(w) ? t(RANGE_LABEL[w.range]) : null);

/** Fixed data instead of live reads — the /dev/widgets gallery renders every widget with it. */
export interface WidgetDemo {
  health?: HealthResult;
  training?: Session | null;
  /** The coach's readout (null = none); undefined means "read it live". */
  readout?: Readout | null;
  /** Local YYYY-MM-DD "today" (the gallery pins it so demo data stays current). */
  today?: string;
  /** Profile fields behind age/sex norms (the VO2max percentile); undefined means "read it live". */
  profile?: { birthYear?: number; sex?: "male" | "female" };
  loading?: boolean;
}

export type WidgetKind = Widget["kind"];

/** What every body gets. `training` is the gallery's session (null = none); undefined means "read it live". */
export type BodyProps<K extends WidgetKind = WidgetKind> = {
  widget: Extract<Widget, { kind: K }>;
  data?: HealthResult;
  training?: Session | null;
  readout?: Readout | null;
  profile?: WidgetDemo["profile"];
  /** Local YYYY-MM-DD of today and the user's IANA timezone (day keys of point/workout instants). */
  today: string;
  timeZone: string;
  /** Gallery render: bodies must not start their own live queries. */
  demo?: boolean;
  loading: boolean;
  error?: string;
};

/** One body per widget kind: a new kind adds an entry here (and to PARAMS), not a branch to a switch. */
const BODIES: { [K in WidgetKind]: (props: BodyProps<K>) => ReactNode } = {
  metric: MetricBody,
  sleep: SleepBody,
  workouts: WorkoutsBody,
  training: TrainingBody,
  macros: MacrosBody,
  readout: ReadoutBody,
  "water-vs-fat": WaterVsFatBody,
  readiness: ReadinessBody,
  streak: StreakBody,
  milestone: MilestoneBody,
  anomalies: AnomaliesBody,
  circumferences: CircumferencesBody,
  "energy-balance": EnergyBalanceBody,
  meals: MealsBody,
  "sleep-schedule": SleepScheduleBody,
  volume: VolumeBody,
  zones: ZonesBody,
  "long-session": LongSessionBody,
  swim: SwimBody,
  lift: LiftBody,
  "muscle-volume": MuscleVolumeBody,
  prs: PrsBody,
  calendar: CalendarBody,
  tdee: TdeeBody,
};

/** The last `days` local days; `to` is tomorrow because the server filters time-stamped rows (points, sleep, workouts) by UTC day. */
const last = (days: number, today: string) => rangeOf(days, today, 1);
const lastOf = (w: { range: keyof typeof RANGES }, today: string) => last(RANGES[w.range], today);

const workoutQuery = (w: { range: keyof typeof RANGES }, today: string) => ({ ...lastOf(w, today), include: ["workouts"] });
/** Daily metrics over a year come as weekly buckets (the server reads day by day up to 92 days). */
const bucketOf = (w: { range: RangeKey }) => (w.range === "1y" ? "week" : undefined);

/** The `get-health` query per kind; null = the kind needs no health query (training reads its own plan). */
const PARAMS: { [K in WidgetKind]: (widget: Extract<Widget, { kind: K }>, today: string) => object | null } = {
  metric: (w, today) => {
    const metrics = w.view === "line" && w.compare ? [w.metric, w.compare] : [w.metric];
    // The band view needs a window of history before the first shown day (server limit: 92 days).
    const range = w.view === "band" ? last(Math.min(92, RANGES[w.range] + BAND_WINDOW_DAYS), today) : lastOf(w, today);
    return { ...range, metrics, include: [...new Set(metrics.map((m) => (getMetric(m)?.kind === "point" ? "points" : "daily")))], bucket: w.view === "band" ? undefined : (w.bucket ?? bucketOf(w)) };
  },
  sleep: (w, today) => ({ ...lastOf(w, today), include: ["sleep"] }),
  workouts: (w, today) => workoutQuery(w, today),
  training: () => null,
  macros: (_w, today) => ({ from: today, to: today, metrics: MACRO_METRICS, include: ["daily"] }),
  readout: () => null,
  "water-vs-fat": (_w, today) => ({ ...last(WATER_DAYS, today), metrics: ["weight"], include: ["points"] }),
  // 60 days of baseline; last night's sleep is a second, two-day query inside the body.
  readiness: (_w, today) => ({ ...last(60, today), metrics: ["hrv_rmssd_night", "hrv_sdnn_night", "resting_hr", "training_readiness"], include: ["daily"] }),
  streak: (w, today) => {
    const base = last(STREAK_DAYS, today);
    if (w.habit === "weigh-in") return { ...base, metrics: ["weight"], include: ["points"] };
    if (w.habit === "workout") return { ...base, include: ["workouts"] };
    if (w.habit === "log-food") return { ...base, metrics: ["intake_energy"], include: ["daily"] };
    return { ...base, metrics: [w.metric], include: [getMetric(w.metric!)?.kind === "point" ? "points" : "daily"] };
  },
  milestone: () => null,
  // The summary's deviation of the latest value from baseline: today's query alone carries it.
  anomalies: (_w, today) => ({ from: today, to: today, include: ["daily"] }),
  circumferences: (w, today) => ({ ...lastOf(w, today), metrics: CIRCUMFERENCE_METRICS, include: ["points"] }),
  "energy-balance": (w, today) => ({ ...lastOf(w, today), metrics: ["intake_energy", "total_energy"], include: ["daily"], bucket: bucketOf(w) }),
  meals: (_w, today) => ({ from: today, to: today, include: ["meals"] }),
  "sleep-schedule": (w, today) => ({ ...lastOf(w, today), include: ["sleep"] }),
  volume: (w, today) => ({ ...workoutQuery(w, today), workoutTypes: SPORT_TYPES[w.sport] }),
  zones: (w, today) => workoutQuery(w, today),
  "long-session": (w, today) => ({ ...workoutQuery(w, today), workoutTypes: SPORT_TYPES[w.sport] }),
  swim: (w, today) => ({ ...workoutQuery(w, today), workoutTypes: SPORT_TYPES.swim }),
  lift: (w, today) => workoutQuery(w, today),
  "muscle-volume": (w, today) => workoutQuery(w, today),
  prs: (w, today) => workoutQuery(w, today),
  // 12 Monday-aligned weeks reach back at most 11 weeks + 6 days.
  calendar: (_w, today) => ({ ...last(84, today), include: ["workouts"] }),
  tdee: (w, today) => ({ ...lastOf(w, today), metrics: ["total_energy", "active_energy"], include: ["daily"], bucket: bucketOf(w) }),
};

const paramsFor = (widget: Widget, today: string): object | null => (PARAMS[widget.kind] as (w: Widget, today: string) => object | null)(widget, today);

const Body = (props: BodyProps) => {
  const Component = BODIES[props.widget.kind] as (props: BodyProps) => ReactNode;
  return <Component {...props} />;
};

/**
 * One widget, rendered on /dashboard and inline in chat (show-widget), as a "bento" card: icon + title and a range
 * pill on top, the figure and its chart filling the rest of the card (content sits at the bottom, so equal-height
 * cards in a row never show a hole). The menu is only shown where the widget can be rearranged (the dashboard).
 * `demo` replaces the live reads (UI gallery).
 */
/** The expanded raw view (/data/:key) for widgets that map to one metric or section; composite widgets have none. */
function dataHrefFor(widget: Widget): string | undefined {
  if (widget.kind === "metric") return `/data/${widget.metric}`;
  if (widget.kind === "sleep" || widget.kind === "workouts" || widget.kind === "meals") return `/data/${widget.kind}`;
  return undefined;
}

export function HealthWidget({
  widget,
  onMove,
  onRemove,
  onRange,
  demo,
  dataHref = dataHrefFor(widget),
}: {
  widget: Widget;
  onMove?: (delta: -1 | 1) => void;
  onRemove?: () => void;
  /** Dashboard only: saves a new range for this widget (the pill becomes a menu). */
  onRange?: (range: RangeKey) => void;
  demo?: WidgetDemo;
  /** "Show data" in the card menu; defaults to the widget's own metric or section, `undefined` hides the item. */
  dataHref?: string;
}) {
  const t = useT();
  const WidgetIcon = iconFor(widget);
  const pill = pillFor(widget, t);
  const body = demo ? (
    <Body widget={widget} data={demo.health} training={demo.training ?? null} readout={demo.readout} profile={demo.profile} today={demo.today ?? dayOf(new Date().toISOString())} timeZone="Europe/Bratislava" demo loading={!!demo.loading} />
  ) : (
    <LiveBody widget={widget} />
  );
  return (
    <Card className={cn("widget-tint flex flex-col gap-4 overflow-hidden p-5", widget.wide && "sm:col-span-2")}>
      <header className="flex items-center gap-3">
        <IconBadge icon={WidgetIcon} />
        <h3 className="min-w-0 flex-1 truncate text-base first-letter:uppercase">{titleFor(widget, t)}</h3>
        {onRange && hasRange(widget) && !metaOf(widget).pill ? <RangePill widget={widget} onRange={onRange} /> : pill && <Pill>{pill}</Pill>}
        {((onMove && onRemove) || dataHref) && <WidgetMenu label={titleFor(widget, t)} onMove={onMove} onRemove={onRemove} dataHref={dataHref} />}
      </header>
      <div className="flex flex-1 flex-col justify-end gap-4">{body}</div>
    </Card>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

function LiveBody({ widget }: { widget: Widget }) {
  const timeZone = useUserTimeZone();
  if (!timeZone) return statusOf({ loading: true });
  const today = dayOf(new Date().toISOString(), timeZone);
  const params = paramsFor(widget, today);
  return params ? <HealthDataBody widget={widget} params={params} today={today} timeZone={timeZone} /> : <Body widget={widget} today={today} timeZone={timeZone} loading={false} />;
}

function HealthDataBody({ widget, params, today, timeZone }: { widget: Widget; params: object; today: string; timeZone: string }) {
  const query = useActionQuery("get-health", params as never, { placeholderData: (previous) => previous });
  const version = useChangeVersion("health");
  useEffect(() => {
    if (version) void query.refetch();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Body widget={widget} data={query.data as HealthResult | undefined} today={today} timeZone={timeZone} loading={query.isLoading} error={query.error?.message} />;
}
