import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { getMetric } from "@vitls/health-ingest";
import { ema, readiness } from "@vitls/physiology";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addDays, anomalies, dayOf, signed, streakDays } from "../../../shared/widget-data";
import type { Readout } from "../../../server/lib/coach/readout";
import type { BodyProps } from ".";
import { BLEED, DotGrid, Empty, Figure, NoteList, Pill, Ring, RING, statusOf, tooltipStyle, useDay, type HealthResult, type Summary } from "./blocks";

const DAY_MS = 86_400_000;
/** "day" / "days" with the 2–4 form Slovak and Czech need; English maps both plural keys to the same word. */
const dayUnit = (n: number) => (n === 1 ? "widgets.unit.day" : n >= 2 && n <= 4 ? "widgets.unit.daysFew" : "widgets.unit.days");

/** The user's IANA timezone from the coach profile: null while it loads, "UTC" when unset or invalid. */
export function useUserTimeZone(): string | null {
  const query = useActionQuery("get-coach-profile", {} as never);
  if (query.isLoading) return null;
  const zone = (query.data as { profile?: { timezone?: string } } | undefined)?.profile?.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone ?? "UTC";
  } catch {
    return "UTC";
  }
}

export const WATER_DAYS = 14;
const humanKey = (key: string) => getMetric(key)?.description ?? key;

// ── Morning readout ─────────────────────────────────────────────────────────

export function ReadoutBody(props: BodyProps<"readout">) {
  // The gallery passes the readout (or null); on the dashboard it is undefined and read live.
  return props.readout !== undefined ? <ReadoutView readout={props.readout} today={props.today} loading={props.loading} /> : <ReadoutLive today={props.today} />;
}

function ReadoutLive({ today }: { today: string }) {
  const query = useActionQuery("get-coach-profile", {} as never);
  return <ReadoutView readout={(query.data as { readout?: Readout | null } | undefined)?.readout ?? null} today={today} loading={query.isLoading} error={query.error?.message} />;
}

function ReadoutView({ readout, today, loading, error }: { readout: Readout | null; today: string; loading: boolean; error?: string }) {
  const t = useT();
  const day = useDay();
  const status = statusOf({ loading, error });
  if (status) return status;
  if (!readout) return <Empty text={t("widgets.empty.readout")} />;
  return (
    <>
      {readout.date !== today && <span className="text-sm text-muted-foreground">{readout.date === addDays(today, -1) ? t("widgets.readout.yesterday") : t("widgets.readout.from", { date: day(readout.date) })}</span>}
      <p className="text-lg leading-snug">{readout.directive}</p>
      {readout.highlights.length > 0 && <NoteList items={readout.highlights.map((h) => ({ title: humanKey(h.metric), detail: h.note }))} />}
    </>
  );
}

// ── Water vs fat ────────────────────────────────────────────────────────────

type LastChange = { deltaKg: number; check: { maxPlausibleFatKg: number; kcalRequired: number } };

export function WaterVsFatBody(props: BodyProps<"water-vs-fat">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const weight = props.data?.points?.weight;
  const change = weight?.lastChange as LastChange | undefined;
  if (!weight || weight.values.length < 2 || !change) return <Empty text={t("widgets.empty.waterVsFat")} />;
  const total = Math.abs(change.deltaKg);
  const fat = Math.min(total, change.check.maxPlausibleFatKg);
  const water = total - fat;
  const kg = (v: number) => `${v.toFixed(1)} kg`;
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{t("widgets.label.sinceLastWeighIn")}</span>
        <Figure value={signed(change.deltaKg, 1)} unit="kg" />
      </div>
      <div role="img" aria-label={`${t("widgets.pill.fatUpTo", { value: kg(fat) })}, ${t("widgets.pill.water", { value: kg(water) })}`} className="flex h-3 w-full overflow-hidden rounded-full bg-muted-foreground/30">
        <span className="bg-primary" style={{ width: `${total > 0 ? (fat / total) * 100 : 0}%` }} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="primary">{t("widgets.pill.fatUpTo", { value: kg(fat) })}</Pill>
        <Pill>{t("widgets.pill.water", { value: kg(water) })}</Pill>
      </div>
      <p className="text-sm text-muted-foreground">{t("widgets.label.realFatNeeds", { kcal: change.check.kcalRequired.toLocaleString() })}</p>
    </>
  );
}

// ── Metric "trend" view ─────────────────────────────────────────────────────

/** Raw values as a thin muted curve with dots, EMA trend in the primary colour, 30-day mean as a dashed ink line. */
export function TrendChart({ rows, format }: { rows: { date: string; value: number }[]; format: (v: number) => string }) {
  const t = useT();
  const day = useDay();
  const trend = new Map(ema(rows).map((p) => [p.date, p.value]));
  const end = rows[rows.length - 1]?.date ?? "";
  const last30 = rows.filter((r) => Date.parse(end) - Date.parse(r.date) < 30 * 86_400_000);
  const mean = last30.reduce((a, r) => a + r.value, 0) / (last30.length || 1);
  const data = rows.map((r) => ({ date: r.date, raw: r.value, trend: trend.get(r.date) }));
  return (
    <>
    <div role="img" aria-label={t("widgets.a11y.trend", { count: rows.length, mean: format(mean) })} className={`${BLEED} min-h-24 relative flex-1`}>
      <ResponsiveContainer width="100%" height="100%" className="absolute inset-0">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[(min: number) => Math.min(min, mean), (max: number) => Math.max(max, mean)]} />
          <ReferenceLine y={mean} stroke="hsl(var(--foreground))" strokeDasharray="4 4" strokeOpacity={0.6} />
          <Tooltip {...tooltipStyle} formatter={(v, name) => [format(Number(v)), t(name === "trend" ? "widgets.trend.trend" : "widgets.trend.value")]} labelFormatter={(d) => day(String(d))} />
          <Line isAnimationActive={false} type="monotone" dataKey="raw" stroke="hsl(var(--muted-foreground) / 0.45)" strokeWidth={1.25} dot={{ r: 1.75, fill: "hsl(var(--muted-foreground) / 0.6)", stroke: "none" }} activeDot={{ r: 3 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="trend" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <p className="text-xs text-muted-foreground tabular-nums">{t("widgets.trend.dashed", { days: last30.length, mean: format(mean) })}</p>
    </>
  );
}

// ── Readiness ───────────────────────────────────────────────────────────────

type Daily = NonNullable<HealthResult["daily"]>[string];
const vitalOf = (d: Daily | undefined) => (d && d.summary.latest !== null ? { recent: d.summary.recent ?? null, baseline: d.summary.baseline ?? null, days: d.summary.days ?? 0 } : undefined);
export function ReadinessBody(props: BodyProps<"readiness">) {
  const { data, today, timeZone } = props;
  const t = useT();
  // Last night only: the 60-day daily query stays free of sleep stages (the gallery supplies sleep in `data`).
  const sleepQuery = useActionQuery("get-health", { from: addDays(today, -2), to: addDays(today, 1), include: ["sleep"] } as never, { enabled: !props.demo });
  const sleep = props.demo ? data?.sleep : (sleepQuery.data as HealthResult | undefined)?.sleep;
  const status = statusOf(props);
  if (status) return status;
  const daily = data?.daily ?? {};
  const rmssd = vitalOf(daily.hrv_rmssd_night);
  const lastNight = [...(sleep ?? [])].reverse().find((s) => s.end && s.durationMin >= 180);
  const sleepDay = lastNight?.end ? dayOf(lastNight.end, timeZone) : null;
  const latestPlatform = daily.training_readiness?.values[daily.training_readiness.values.length - 1];
  const platform = latestPlatform && latestPlatform.date >= addDays(today, -1) ? latestPlatform : undefined;
  const result = readiness({
    hrv: rmssd ?? vitalOf(daily.hrv_sdnn_night),
    rhr: vitalOf(daily.resting_hr),
    sleepHours: lastNight && sleepDay! >= addDays(today, -1) ? lastNight.durationMin / 60 : null,
    platformScore: platform?.value ?? null,
  });
  // A platform (Garmin) score stands on its own; otherwise a built HRV / RHR baseline is needed.
  if (result.score === null || (!result.enoughHistory && !platform)) return <Empty text={t("widgets.empty.notEnoughHistory")} />;
  return (
    <>
      <div className="flex flex-1 items-center justify-center">
        <Ring
          segments={[
            { fraction: result.score / 100, color: RING.primary },
            { fraction: 1 - result.score / 100, color: RING.muted },
          ]}
          value={String(result.score)}
          label={result.verdict ? t(`widgets.verdict.${result.verdict}`) : t("widgets.ring.of100")}
        />
      </div>
      <ul className="flex flex-wrap justify-center gap-2">
        {result.drivers.map((d) => (
          <li key={d.key}>
            <Pill>
              {t(`widgets.driver.${d.key}`)} {signed(Math.round(d.deltaPct))} %
            </Pill>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Streak ──────────────────────────────────────────────────────────────────

export const STREAK_DAYS = 90;

/** Local days (oldest first) on which the habit held. */
function habitDays(widget: BodyProps<"streak">["widget"], data: HealthResult | undefined, timeZone: string): Set<string> {
  const ok = new Set<string>();
  if (widget.habit === "weigh-in") for (const v of data?.points?.weight?.values ?? []) ok.add(dayOf(v.at, timeZone));
  else if (widget.habit === "workout") for (const w of data?.workouts ?? []) ok.add(dayOf(w.start, timeZone));
  else if (widget.habit === "log-food") for (const v of data?.daily?.intake_energy?.values ?? []) if (v.value > 0) ok.add(v.date);
  else if (widget.metric) {
    const held = (v: number) => (widget.min === undefined || v >= widget.min) && (widget.max === undefined || v <= widget.max);
    const series = data?.daily?.[widget.metric]?.values.map((v) => [v.date, v.value] as const) ?? data?.points?.[widget.metric]?.values.map((v) => [dayOf(v.at, timeZone), v.value] as const) ?? [];
    for (const [date, value] of series) if (held(value)) ok.add(date);
  }
  return ok;
}

export function StreakBody(props: BodyProps<"streak">) {
  const { widget, data, today, timeZone } = props;
  const t = useT();
  const day = useDay({ weekday: "short", day: "numeric", month: "short" });
  const status = statusOf(props);
  if (status) return status;
  const section = widget.habit === "weigh-in" ? data?.points : widget.habit === "workout" ? data?.workouts : widget.habit === "metric" ? (data?.daily ?? data?.points) : data?.daily;
  if (!section) return <Empty text={t("widgets.empty.noData")} />;
  const held = habitDays(widget, data, timeZone);
  const days = Array.from({ length: STREAK_DAYS }, (_, i) => {
    const date = addDays(today, i - (STREAK_DAYS - 1));
    return { date, ok: held.has(date) };
  });
  const { current, grid } = streakDays(days, today);
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{t(`widgets.streak.${widget.habit}`)}</span>
        <Figure value={String(current)} unit={t(dayUnit(current))} />
      </div>
      <DotGrid cells={grid.map((c) => ({ key: c.date, state: c.ok === null ? "none" : c.ok ? "on" : "off", title: `${day(c.date)} · ${t(c.ok === null ? "widgets.streak.upcoming" : c.ok ? "widgets.streak.done" : "widgets.streak.missed")}` }))} />
    </>
  );
}

// ── Milestone ───────────────────────────────────────────────────────────────

export function MilestoneBody(props: BodyProps<"milestone">) {
  const { widget, today } = props;
  const t = useT();
  const day = useDay({ day: "numeric", month: "short", year: "numeric" });
  const status = statusOf(props);
  if (status) return status;
  const days = Math.floor((Date.parse(today) - Date.parse(widget.since)) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return <Empty text={t("widgets.milestone.starts", { date: day(widget.since) })} />;
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{widget.label}</span>
        <Figure value={days.toLocaleString()} unit={t(dayUnit(days))} />
      </div>
      <Pill>{t("widgets.milestone.since", { date: day(widget.since) })}</Pill>
    </div>
  );
}

// ── Anomalies ───────────────────────────────────────────────────────────────

export function AnomaliesBody(props: BodyProps<"anomalies">) {
  const { widget, data } = props;
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const found = anomalies((data?.daily ?? {}) as Record<string, { summary?: Summary }>, widget.threshold);
  if (!found.length) return <Empty text={t("widgets.empty.anomalies")} />;
  return <NoteList items={found.map((a) => ({ title: humanKey(a.metric), detail: `${signed(Math.round(a.deviationPct))} %` }))} />;
}
