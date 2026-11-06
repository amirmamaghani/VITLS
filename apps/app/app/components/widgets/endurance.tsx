import { useT } from "@agent-native/core/client/i18n";

import { RANGES } from "../../../shared/dashboard";
import { easyShare, longestPerWeek, rangeOf, SPORT_TYPES, swimStats, weeklyVolume, zoneTotals } from "../../../shared/widget-data";
import type { BodyProps } from ".";
import { Bars, DateSpan, Empty, hm, Stat, statusOf, Wave } from "./blocks";

const weeksOf = (w: { range: keyof typeof RANGES }, today: string) => rangeOf(RANGES[w.range], today);

/** Swim distances read better in metres, everything else in kilometres. */
const distance = (sport: string) => (sport === "swim" ? { div: 1, unit: "m", digits: 0 } : { div: 1000, unit: "km", digits: 1 });
const amount = (m: number, sport: string) => {
  const d = distance(sport);
  return Number((m / d.div).toFixed(d.digits));
};
const duration = (min: number) => {
  const t = Math.round(min);
  return t >= 60 ? `${Math.floor(t / 60)} h ${t % 60} min` : `${t} min`;
};

/** Distance per week for a sport; this week is the primary bar. */
export function VolumeBody(props: BodyProps<"volume">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const { widget } = props;
  const rows = weeklyVolume(props.data?.workouts ?? [], widget.sport, props.timeZone, weeksOf(widget, props.today));
  if (!rows.some((r) => r.distanceM > 0 || r.minutes > 0)) return <Empty text={t(`widgets.empty.sport.${widget.sport}`)} />;
  const d = distance(widget.sport);
  const now = rows[rows.length - 1]!;
  const bars = rows.map((r) => ({ date: r.week, value: amount(r.distanceM, widget.sport) }));
  return (
    <>
      <Stat label={t("widgets.label.thisWeek")} value={String(bars[bars.length - 1]!.value)} unit={d.unit} pill={duration(now.minutes)} size="lg" />
      <Bars rows={bars} format={(v) => `${v} ${d.unit}`} />
      <DateSpan rows={bars} />
    </>
  );
}

// Zones 1–5, grey to primary (opacity steps of the two tokens).
const ZONE_FILL = ["hsl(var(--muted-foreground) / 0.25)", "hsl(var(--muted-foreground) / 0.5)", "hsl(var(--primary) / 0.4)", "hsl(var(--primary) / 0.7)", "hsl(var(--primary))"];

/** Time in heart-rate zones as one horizontal stacked bar. */
export function ZonesBody(props: BodyProps<"zones">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const totals = zoneTotals(props.data?.workouts ?? []);
  const shown = totals.filter((t) => t.zone >= 1 && t.zone <= 5 && t.seconds > 0);
  if (shown.length === 0) return <Empty text={t("widgets.empty.zones")} />;
  const all = shown.reduce((a, t) => a + t.seconds, 0);
  const easy = easyShare(shown);
  return (
    <>
      <Stat label={t("widgets.label.timeInZones")} value={duration(all / 60)} pill={easy === null ? undefined : t("widgets.pill.easyShare", { percent: Math.round(easy * 100) })} />
      <div role="img" aria-label={shown.map((z) => `${t("widgets.zone", { zone: z.zone })} ${Math.round((z.seconds / all) * 100)} %`).join(", ")} className="flex h-6 w-full gap-1">
        {shown.map((z) => (
          <span key={z.zone} title={`${t("widgets.zone", { zone: z.zone })} · ${duration(z.seconds / 60)}`} className="rounded-full" style={{ flex: z.seconds, background: ZONE_FILL[z.zone - 1] }} />
        ))}
      </div>
      <ul className="flex justify-between text-xs text-muted-foreground tabular-nums">
        {shown.map((z) => (
          <li key={z.zone}>
            Z{z.zone} {Math.round((z.seconds / all) * 100)}%
          </li>
        ))}
      </ul>
    </>
  );
}

/** The longest single session of each week. */
export function LongSessionBody(props: BodyProps<"long-session">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const { widget } = props;
  const rows = longestPerWeek(props.data?.workouts ?? [], widget.sport, props.timeZone, weeksOf(widget, props.today));
  if (!rows.some((r) => r.distanceM > 0)) return <Empty text={t(`widgets.empty.sport.${widget.sport}`)} />;
  const d = distance(widget.sport);
  const bars = rows.map((r) => ({ date: r.week, value: amount(r.distanceM, widget.sport) }));
  return (
    <>
      <Stat label={t("widgets.label.longestInRange")} value={String(Math.max(...bars.map((b) => b.value)))} unit={d.unit} size="lg" tone="plain" />
      <Bars rows={bars} format={(v) => `${v} ${d.unit}`} />
      <DateSpan rows={bars} />
    </>
  );
}

/** Pace per 100 m; lower is better, so the axis is inverted (faster = higher). */
export function SwimBody(props: BodyProps<"swim">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const swims = swimStats(props.data?.workouts ?? [], props.timeZone);
  if (swims.length === 0) return <Empty text={t("widgets.empty.sport.swim")} />;
  const last = swims[swims.length - 1]!;
  const rows = swims.map((s) => ({ date: s.date, value: s.pacePer100s }));
  return (
    <>
      <Stat label={t("widgets.label.latestPace")} value={hm(last.pacePer100s)} unit="min/100 m" pill={last.swolf === null ? undefined : `SWOLF ${Math.round(last.swolf)}`} size="lg" />
      {rows.length > 1 && <Wave rows={rows} reversed format={(v) => `${hm(v)} min/100 m`} />}
      <DateSpan rows={rows} />
    </>
  );
}
