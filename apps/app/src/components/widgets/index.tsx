/** HealthWidget — ONE component rendered identically on Today, on a board, and inline in chat
    (show-widget). `placement` only changes the outer frame; the inner content is the same.
    Data is passed in (Today/board fetch it); without data a widget shows a graceful preview. */
import { Bookmark, Check, Dumbbell, Flame } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Card, CardHeader, Figure } from "@/components/ui";
import { Sparkle } from "@/components/Sparkles";
import { type TFunc, useT } from "@/lib/i18n";
import { useColors } from "@/lib/theme";
import { s } from "@/lib/scale";

/** Loose config — the subset of @vitls/dashboard's Widget that the UI reads. */
export interface WidgetConfig {
  id?: string;
  kind: string;
  title?: string;
  metric?: string;
  view?: string;
  range?: string;
  [k: string]: unknown;
}

export interface MacroData {
  kcal: { eaten: number; goal?: number };
  protein: { g: number; goal?: number };
  carbs: { g: number; goal?: number };
  fat: { g: number; goal?: number };
}
export interface ReadoutData {
  greeting?: string;
  directive: string;
  highlights: { metric: string; note: string }[];
  updatedAt?: string;
}
export interface WeekDay {
  d: string;
  n: number;
  state: "done" | "today" | "planned" | "rest" | "missed";
}
export interface SessionRow {
  name: string;
  scheme?: string;
  cue?: string;
  status?: "done" | "active" | "idle";
}
export interface MealSlot {
  label: string;
  state: "logged" | "planned" | "reading";
  title?: string;
  kcal?: number;
}
export interface WidgetData {
  value?: string;
  unit?: string;
  label?: string;
  readout?: ReadoutData | null;
  macros?: MacroData;
  week?: { days: WeekDay[]; done: number; total: number };
  readiness?: { score: number; verdict: string; note?: string };
  session?: { title: string; duration?: string; rows: SessionRow[] };
  meals?: { title?: string; of: number; plan: number; slots: MealSlot[] };
}

type Placement = "today" | "board" | "chat";

/** Chat-inline frame gets a Pin affordance (append the same widget to the thread's board). */
export function HealthWidget({ widget, data, placement = "board", onPin, pinned }: { widget: WidgetConfig; data?: WidgetData; placement?: Placement; onPin?: () => void; pinned?: boolean }) {
  const body = <WidgetBody widget={widget} data={data} />;
  if (placement !== "chat") return body;
  return (
    <View className="w-full gap-2">
      {body}
      <Pressable onPress={onPin} disabled={pinned} className="flex-row items-center gap-1.5 self-start rounded-full bg-primary px-3 py-1.5" accessibilityLabel="Pin to dashboard">
        {pinned ? <Check color="#202124" size={14} /> : <Bookmark color="#202124" size={14} />}
        <Text className="text-xs font-semibold text-primary-foreground">{pinned ? "Pinned" : "Pin to dashboard"}</Text>
      </Pressable>
    </View>
  );
}

function WidgetBody({ widget, data }: { widget: WidgetConfig; data?: WidgetData }) {
  switch (widget.kind) {
    case "readout":
      return <ReadoutWidget data={data?.readout} />;
    case "metric":
      return <MetricWidget widget={widget} data={data} />;
    case "macros":
      return <MacrosWidget data={data?.macros} />;
    case "week":
      return <WeekWidget data={data?.week} />;
    case "readiness":
      return <ReadinessWidget data={data?.readiness} />;
    case "workout-today":
      return <SessionWidget data={data?.session} />;
    case "meal-slots":
    case "meals":
      return <MealSlotsWidget data={data?.meals} />;
    default:
      return <PreviewWidget widget={widget} />;
  }
}

/** Dark ink hero with a peach eyebrow — the coach's directive for today. Always dark (never flips in
    dark mode): the text/eyebrow are light, so the background must stay dark in both themes. */
function ReadoutWidget({ data }: { data?: ReadoutData | null }) {
  const c = useColors();
  const t = useT();
  if (!data) return <Card><Text className="text-muted-foreground" style={{ fontSize: s(15) }}>{t("widget.noReadout")}</Text></Card>;
  return (
    <View style={{ borderRadius: s(28), padding: s(22), gap: s(12), backgroundColor: c.dark ? "#202024" : "#141414" }} className="overflow-hidden">
      <View className="flex-row items-center justify-between">
        <Text style={{ fontSize: s(12), fontWeight: "700", letterSpacing: 0.7, color: "#ffe2d1" }}>{t("widget.coachToday")}</Text>
        {data.updatedAt ? (
          <View className="flex-row items-center" style={{ gap: s(4) }}>
            <Sparkle size={s(11)} color="#ffe2d1" />
            <Text style={{ fontSize: s(11), color: "#ffe2d1" }}>{t("widget.updated", { at: data.updatedAt })}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ fontSize: s(19), fontWeight: "600", lineHeight: s(26), letterSpacing: -0.2, color: "#f4f4f6" }}>{data.directive}</Text>
      {data.highlights.slice(0, 3).map((h) => (
        <Text key={h.metric} style={{ fontSize: s(13), color: "#b9b9bd" }}>{metricLabel(t, h.metric).label}: {h.note}</Text>
      ))}
    </View>
  );
}

/** Known metric keys + their units; the human label comes from i18n (`metric.<key>`), so boards never show
    a raw key like "resting_hr" and translate with the app language. Unknown keys fall back to Title Case. */
const METRIC_UNITS: Record<string, string | undefined> = {
  weight: "kg",
  resting_hr: "bpm",
  steps: undefined,
  sleep_duration: "h",
  sleep_score: undefined,
  vo2max: undefined,
  hrv_rmssd_night: "ms",
  hrv_sdnn_night: "ms",
  body_fat_pct: "%",
  muscle_mass: "kg",
  lean_mass: "kg",
  active_energy: "kcal",
  total_energy: "kcal",
  distance: "km",
  intensity_minutes: "min",
  training_readiness: undefined,
};
export const metricLabel = (t: TFunc, m?: string): { label: string; unit?: string } =>
  !m ? { label: t("metric.fallback") } : { label: m in METRIC_UNITS ? t(`metric.${m}`) : titleCase(m), unit: METRIC_UNITS[m] };

function MetricWidget({ widget, data }: { widget: WidgetConfig; data?: WidgetData }) {
  const t = useT();
  const meta = metricLabel(t, widget.metric);
  return (
    <Card className="gap-2">
      <CardHeader title={data?.label ?? widget.title ?? meta.label} />
      <Figure value={data?.value ?? "–"} unit={data?.unit ?? (data?.value ? meta.unit : undefined)} size="md" />
    </Card>
  );
}

/** kcal-left ring (ink) + three P/C/F target bars (peach fill where hit). */
function MacrosWidget({ data }: { data?: MacroData }) {
  const c = useColors();
  const t = useT();
  const left = data ? Math.max(0, (data.kcal.goal ?? 0) - data.kcal.eaten) : undefined;
  return (
    <Card className="gap-3">
      <CardHeader icon={<Flame color={c.fg} size={18} />} title={t("widget.nutrition")} />
      <View className="flex-row items-baseline gap-2">
        <Figure value={left !== undefined ? left.toLocaleString() : (data?.kcal.eaten.toLocaleString() ?? "–")} unit={left !== undefined ? t("widget.kcalLeft") : t("widget.kcal")} size="lg" />
      </View>
      {data?.kcal.goal ? <Text className="-mt-1 text-muted-foreground" style={{ fontSize: s(11.5) }}>{t("widget.eatenGoal", { eaten: data.kcal.eaten.toLocaleString(), goal: data.kcal.goal.toLocaleString() })}</Text> : null}
      {data ? (
        <View className="gap-2">
          <MacroBar label={t("macro.protein")} g={data.protein.g} goal={data.protein.goal} c={c} />
          <MacroBar label={t("macro.carbs")} g={data.carbs.g} goal={data.carbs.goal} c={c} />
          <MacroBar label={t("macro.fat")} g={data.fat.g} goal={data.fat.goal} c={c} />
        </View>
      ) : null}
    </Card>
  );
}
function MacroBar({ label, g, goal, c }: { label: string; g: number; goal?: number; c: ReturnType<typeof useColors> }) {
  const pct = goal ? Math.min(1, g / goal) : 0;
  const hit = goal ? g >= goal : false;
  return (
    <View className="gap-1">
      <View className="flex-row justify-between">
        <Text className="text-muted-foreground" style={{ fontSize: s(11.5) }}>{label}</Text>
        <Text className="text-foreground" style={{ fontSize: s(11.5), fontVariant: ["tabular-nums"] }}>{Math.round(g)}{goal ? ` / ${goal}g` : "g"}</Text>
      </View>
      {goal ? (
        <View style={{ height: s(8), backgroundColor: c.line, borderRadius: 999 }} className="overflow-hidden">
          <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: hit ? c.accent : c.fg, borderRadius: 999 }} />
        </View>
      ) : null}
    </View>
  );
}

function WeekWidget({ data }: { data?: { days: WeekDay[]; done: number; total: number } }) {
  const c = useColors();
  const t = useT();
  const days = data?.days;
  const letters = t("widget.weekdays").split(","); // fallback day initials, server-sent days carry their own
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground" style={{ fontSize: s(12.5), fontWeight: "800" }}>{t("widget.thisWeek")}</Text>
        {data ? <Text className="text-muted-foreground" style={{ fontSize: s(11.5), fontWeight: "600" }}>{t("widget.sessionsOf", { done: data.done, total: data.total })}</Text> : null}
      </View>
      <View className="flex-row justify-between">
        {(days ?? letters.map((d, i) => ({ d, n: 12 + i, state: i === 3 ? ("today" as const) : i < 3 ? ("done" as const) : ("rest" as const) }))).map((day, i) => {
          const bg = day.state === "today" ? c.accent : day.state === "done" ? c.tint : "transparent";
          const border = day.state === "planned" ? c.fg : day.state === "missed" ? c.danger : "transparent";
          const fg = day.state === "rest" ? c.muted : c.fg;
          return (
            <View key={i} className="items-center" style={{ gap: s(6) }}>
              <Text style={{ fontSize: s(10), fontWeight: "700", color: c.muted }}>{day.d}</Text>
              <View style={{ width: s(36), height: s(36), borderRadius: 999, backgroundColor: bg, borderWidth: border === "transparent" ? 0 : 1.5, borderColor: border }} className="items-center justify-center">
                <Text style={{ fontSize: s(13), fontWeight: "700", color: fg, fontVariant: ["tabular-nums"] }}>{day.n}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function ReadinessWidget({ data }: { data?: { score: number; verdict: string; note?: string } }) {
  const c = useColors();
  const t = useT();
  const score = data?.score ?? 0;
  const r = 34, circ = 2 * Math.PI * r, off = circ * (1 - score / 100);
  return (
    <Card className="flex-row items-center gap-4">
      <View style={{ width: 80, height: 80 }}>
        <Svg width={80} height={80} viewBox="0 0 84 84">
          <Circle cx={42} cy={42} r={r} fill="none" stroke={c.line} strokeWidth={9} />
          {data ? <Circle cx={42} cy={42} r={r} fill="none" stroke={c.fg} strokeWidth={9} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 42 42)" /> : null}
        </Svg>
        <View className="absolute inset-0 items-center justify-center">
          <Text className="text-2xl text-foreground" style={{ fontWeight: "300", fontVariant: ["tabular-nums"] }}>{data ? score : "–"}</Text>
          <Text className="text-[9px] font-bold tracking-widest text-muted-foreground">{t("widget.ready")}</Text>
        </View>
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-foreground">{data?.verdict ?? t("widget.readiness")}</Text>
        {data?.note ? <Text className="text-sm leading-snug text-muted-foreground">{data.note}</Text> : <Text className="text-sm text-muted-foreground">{t("widget.needsReadiness")}</Text>}
      </View>
    </Card>
  );
}

function SessionWidget({ data }: { data?: { title: string; duration?: string; rows: SessionRow[] } }) {
  const c = useColors();
  const t = useT();
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-foreground">{data?.title ?? t("widget.todaysSession")}</Text>
        {data?.duration ? <Text className="text-xs text-muted-foreground">{data.duration}</Text> : null}
      </View>
      {data?.rows.length ? (
        <View className="gap-2.5">
          {data.rows.map((row, i) => (
            <View key={i} className="flex-row items-center gap-3">
              <View className="h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: row.status === "done" ? c.accent : c.card }}>
                {row.status === "done" ? <Check color="#202124" size={14} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: row.status === "active" ? c.fg : c.muted }} />}
              </View>
              <Text className="flex-1 text-sm text-foreground">{row.name}</Text>
              {row.scheme ? <Text className="text-xs text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>{row.scheme}</Text> : null}
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-sm text-muted-foreground">{t("widget.noSession")}</Text>
      )}
    </Card>
  );
}

function MealSlotsWidget({ data }: { data?: { title?: string; of: number; plan: number; slots: MealSlot[] } }) {
  const c = useColors();
  const t = useT();
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-bold tracking-wide text-foreground">{t("widget.todaysMeals")}{data ? ` · ${data.of}/${data.plan}` : ""}</Text>
        {data ? <View className="rounded-full bg-primary px-2.5 py-0.5"><Text className="text-[11px] font-semibold text-primary-foreground">{t("widget.mealPlan", { n: data.plan })}</Text></View> : null}
      </View>
      {data?.slots.map((slot, i) => (
        <View key={i} className={`flex-row items-center gap-3 rounded-2xl px-3 py-2.5 ${slot.state === "planned" ? "border border-dashed" : ""}`} style={slot.state === "planned" ? { borderColor: c.line } : { backgroundColor: c.card }}>
          <Text className="flex-1 text-sm text-foreground">{slot.label}{slot.title ? ` · ${slot.title}` : ""}</Text>
          {slot.state === "planned" ? <Text className="text-xs text-muted-foreground">{t("widget.planned")}</Text> : slot.kcal ? <Text className="text-xs text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>{slot.kcal} kcal</Text> : null}
        </View>
      ))}
    </Card>
  );
}

/** Any kind without a live renderer yet: a styled frame so boards never break (iteration 1). */
function PreviewWidget({ widget }: { widget: WidgetConfig }) {
  const t = useT();
  return (
    <Card className="gap-1">
      <CardHeader icon={<Dumbbell color={useColors().muted} size={16} />} title={widget.title ?? titleCase(widget.kind)} />
      <Text className="text-xs text-muted-foreground">{labelFor(widget)} · {t("widget.liveDataComing")}</Text>
    </Card>
  );
}
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
function labelFor(w: WidgetConfig): string {
  const bits = [w.metric, w.view, w.range].filter(Boolean) as string[];
  return bits.length ? bits.join(" · ") : titleCase(w.kind);
}
