import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { getMetric } from "@vitls/health-ingest";
import { vo2maxPercentile } from "@vitls/physiology";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { RANGES, ringProgress } from "../../../shared/dashboard";
import { addDays, dayOf, rollingBand, signed } from "../../../shared/widget-data";
import type { BodyProps } from ".";
import { TrendChart } from "./coach";
import { BandLine, BLEED, Bars, DateSpan, Empty, Figure, formatParts, formatValue, Pill, Ring, RING, statusOf, tooltipStyle, useDay, Wave, type HealthResult } from "./blocks";

function Delta({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null;
  return (
    <Pill tone="primary">
      {pct > 0 ? "+" : ""}
      {pct}%
    </Pill>
  );
}

function Headline({ label, metric, value, pct, size }: { label: string; metric: string; value: number | null | undefined; pct?: number | null; size?: "lg" | "md" }) {
  const p = formatParts(metric, value);
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Figure value={p.value} unit={p.unit} size={size} />
      </div>
      <Delta pct={pct} />
    </div>
  );
}

/** The rate view only makes sense for body composition, where a healthy pace is a share of body mass per week. */
const RATE_METRICS = ["weight", "lean_mass", "muscle_mass"];

const seriesOf = (data: HealthResult | undefined, metric: string) => data?.daily?.[metric] ?? data?.points?.[metric];

/** One value per day: the daily series (or its buckets), or the last of several readings a day. */
const rowsOf = (data: HealthResult | undefined, metric: string, timeZone: string): { date: string; value: number }[] =>
  (data?.daily?.[metric]?.buckets ?? data?.daily?.[metric]?.values) ??
  (data?.points?.[metric] && [...new Map(data.points[metric]!.values.map((v) => [dayOf(v.at, timeZone), v.value])).entries()].map(([date, value]) => ({ date, value }))) ??
  [];

/** Two metrics on shared day keys, each fitted to its own hidden axis (different units): main primary, compare ink. */
function CompareLines({ main, other, format }: { main: { date: string; value: number }[]; other: { date: string; value: number }[]; format: (key: "a" | "b", v: number) => string }) {
  const day = useDay();
  const a = new Map(main.map((r) => [r.date, r.value]));
  const b = new Map(other.map((r) => [r.date, r.value]));
  const data = [...new Set([...a.keys(), ...b.keys()])].sort().map((date) => ({ date, a: a.get(date), b: b.get(date) }));
  return (
    <div className={`${BLEED} min-h-20 relative flex-1`}>
      <ResponsiveContainer width="100%" height="100%" className="absolute inset-0">
        <LineChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis yAxisId="a" hide domain={["dataMin", "dataMax"]} />
          <YAxis yAxisId="b" hide domain={["dataMin", "dataMax"]} />
          <Tooltip {...tooltipStyle} labelFormatter={(d) => day(String(d))} formatter={(v, name) => [format(name as "a" | "b", Number(v)), ""]} separator="" />
          <Line yAxisId="a" isAnimationActive={false} connectNulls type="monotone" dataKey="a" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line yAxisId="b" isAnimationActive={false} connectNulls type="monotone" dataKey="b" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The metric catalog's description ("Resting heart rate"), never the raw key. */
const metricName = (key: string) => getMetric(key)?.description ?? key.replace(/_pct$/, " %").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const Dot = ({ className }: { className: string }) => <span className={`mr-2 size-2 rounded-full ${className}`} aria-hidden="true" />;

/** Any catalog metric as a number, line, bar or ring view. */
export function MetricBody(props: BodyProps<"metric">) {
  const { widget, data } = props;
  const t = useT();
  // Age and sex for the VO2max percentile: the gallery passes them, the dashboard reads the (cached) coach profile.
  const profileQuery = useActionQuery("get-coach-profile", {} as never, { enabled: !props.demo && widget.metric === "vo2max" && widget.view === "ring" });
  const profile = props.demo ? props.profile : (profileQuery.data as { profile?: BodyProps["profile"] } | undefined)?.profile;
  const status = statusOf(props);
  if (status) return status;

  const series = seriesOf(data, widget.metric);
  const rows = rowsOf(data, widget.metric, props.timeZone);
  const s = series?.summary;
  if (!s || (s.latest === null && rows.length === 0)) return <Empty text={t("widgets.empty.noData")} />;
  const format = (v: number) => formatValue(widget.metric, v);
  const bucketed = widget.bucket !== undefined && widget.bucket !== "day";
  const label = bucketed ? t(`widgets.label.this.${widget.bucket}`) : t("widgets.label.latest");
  const latest = bucketed ? rows[rows.length - 1]?.value : s.latest;

  const rate = widget.view === "rate" && RATE_METRICS.includes(widget.metric) && s.latest ? s.ratePerWeek : undefined;
  if (rate !== undefined && rate !== null) {
    const pct = (rate / s.latest!) * 100;
    const inBand = Math.abs(pct) >= 0.25 && Math.abs(pct) <= 1;
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <Ring
            segments={[
              { fraction: Math.min(1, Math.abs(pct)), color: inBand ? RING.primary : RING.light },
              { fraction: 1 - Math.min(1, Math.abs(pct)), color: RING.muted },
            ]}
            value={`${signed(pct, 1)} %`}
            label={t("widgets.label.perWeek")}
          />
        </div>
        <p className="text-center text-sm text-muted-foreground tabular-nums">{t("widgets.label.healthyPace")}</p>
      </>
    );
  }

  if (widget.view === "band") {
    // The query reaches a window further back; show only the widget's range, with the band moving day by day.
    const first = addDays(props.today, 1 - RANGES[widget.range]);
    const band = rollingBand(rows).filter((r) => r.date >= first);
    const now = band[band.length - 1];
    if (!now || now.low === null || now.high === null) return <Empty text={t("widgets.empty.notEnoughHistory")} />;
    const where = now.value > now.high ? "above" : now.value < now.low ? "below" : "inRange";
    return (
      <>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{t("widgets.label.latest")}</span>
            <Figure value={formatParts(widget.metric, now.value).value} unit={formatParts(widget.metric, now.value).unit} size="md" />
          </div>
          <Pill tone={where === "inRange" ? "primary" : "plain"}>{t(`widgets.band.${where}`)}</Pill>
        </div>
        <BandLine rows={band} format={format} />
        <DateSpan rows={band} />
      </>
    );
  }

  const otherRows = widget.view === "line" && widget.compare ? rowsOf(data, widget.compare, props.timeZone) : [];
  if (otherRows.length > 1 && widget.compare) {
    const compare = widget.compare;
    return (
      <>
        <Headline label={label} metric={widget.metric} value={latest} pct={s.deviationPct} size="md" />
        <ul className="flex flex-wrap gap-2">
          <li>
            <Pill>
              <Dot className="bg-primary" />
              {metricName(widget.metric)}
            </Pill>
          </li>
          <li>
            <Pill>
              <Dot className="bg-foreground" />
              {metricName(compare)}
            </Pill>
          </li>
        </ul>
        <CompareLines main={rows} other={otherRows} format={(k, v) => formatValue(k === "a" ? widget.metric : compare, v)} />
        <DateSpan rows={rows} />
      </>
    );
  }

  if (widget.view === "ring" && widget.metric === "vo2max" && latest != null && profile?.birthYear && profile.sex) {
    const percentile = vo2maxPercentile(latest, Number(props.today.slice(0, 4)) - profile.birthYear, profile.sex);
    return (
      <>
        <div className="flex flex-1 items-center justify-center" title={t("widgets.vo2max.approximate")}>
          <Ring
            segments={[
              { fraction: percentile / 100, color: RING.primary },
              { fraction: 1 - percentile / 100, color: RING.muted },
            ]}
            value={t("widgets.vo2max.top", { percent: 100 - percentile })}
            label={t("widgets.vo2max.forYourAge")}
          />
        </div>
        <p className="text-center text-sm text-muted-foreground tabular-nums">{t("widgets.vo2max.caption", { value: formatValue(widget.metric, latest) })}</p>
      </>
    );
  }

  if (widget.view === "ring") {
    const unit = getMetric(widget.metric)?.unit;
    const ring = ringProgress({ unit, latest, target: widget.target, start: widget.start });
    if (!ring) return <Headline label={label} metric={widget.metric} value={latest} pct={s.deviationPct} />;
    const caption =
      widget.start !== undefined && widget.target !== undefined
        ? t("widgets.ring.journey", { start: formatValue(widget.metric, widget.start), target: formatValue(widget.metric, widget.target), now: formatValue(widget.metric, latest) })
        : widget.target !== undefined
          ? t("widgets.ring.ofTarget", { now: formatValue(widget.metric, latest), target: formatValue(widget.metric, widget.target) })
          : null;
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <Ring
            segments={[
              { fraction: ring.fraction, color: RING.primary },
              { fraction: 1 - ring.fraction, color: RING.muted },
            ]}
            value={widget.target === undefined && unit === "score" ? String(Math.round(latest!)) : `${ring.pct}%`}
            label={widget.start !== undefined ? t("widgets.ring.toGoal") : widget.target !== undefined ? t("widgets.ring.target") : t("widgets.ring.of100")}
          />
        </div>
        {caption && <p className="text-center text-sm text-muted-foreground tabular-nums">{caption}</p>}
      </>
    );
  }

  if (widget.view === "number") {
    return (
      <>
        {rows.length > 2 && <Wave rows={rows} format={format} muted />}
        <Headline label={label} metric={widget.metric} value={latest} pct={s.deviationPct} />
      </>
    );
  }
  return (
    <>
      <Headline label={label} metric={widget.metric} value={latest} pct={s.deviationPct} size="md" />
      {widget.view === "line" || widget.view === "rate" ? <Wave rows={rows} format={format} /> : widget.view === "trend" ? <TrendChart rows={rows} format={format} /> : <Bars rows={rows} format={format} />}
      <DateSpan rows={rows} />
    </>
  );
}
