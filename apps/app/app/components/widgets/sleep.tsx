import { useT } from "@agent-native/core/client/i18n";

import { dayOf, regularity, sleepSchedule, sleepStages, type SleepRow } from "../../../shared/widget-data";
import { Bars, DateSpan, Empty, Figure, hm, Pill, RangeBars, StackedBars, statusOf } from "./blocks";
import type { BodyProps } from ".";

const sessionsOf = (data: BodyProps["data"]): SleepRow[] => (data?.sleep ?? []).flatMap((s) => (s.end ? [{ ...s, end: s.end }] : []));

// deep primary, REM primary/60, light ink/25, awake grey: opacity steps of the three tokens.
const STAGE_COLORS = ["hsl(var(--primary))", "hsl(var(--primary) / 0.6)", "hsl(var(--foreground) / 0.25)", "hsl(var(--muted-foreground) / 0.3)"];

export function SleepBody(props: BodyProps<"sleep">) {
  const { data, widget, timeZone } = props;
  const t = useT();
  const status = statusOf(props);
  if (status) return status;

  if (widget.view === "stages") {
    const nights = sleepStages(sessionsOf(data), timeZone).filter((n) => n.deep + n.rem + n.light + n.awake > 0);
    if (nights.length === 0) return <Empty text={t("widgets.empty.sleepStages")} />;
    const total = nights.reduce((a, n) => a + n.deep + n.rem + n.light + n.awake, 0);
    const restorative = nights.reduce((a, n) => a + n.deep + n.rem, 0);
    return (
      <>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{t("widgets.label.deepPlusRem")}</span>
            <Figure value={String(Math.round((restorative / total) * 100))} unit="%" size="md" />
          </div>
          <Pill tone="primary">{t("widgets.pill.lastNight", { value: `${hm(nights[nights.length - 1]!.deep + nights[nights.length - 1]!.rem)} h` })}</Pill>
        </div>
        <StackedBars
          rows={nights.map((n) => ({ date: n.date, parts: [n.deep, n.rem, n.light, n.awake] }))}
          colors={STAGE_COLORS}
          format={(v) => `${hm(v)} h`}
        />
        <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {(["deep", "rem", "light", "awake"] as const).map((stage, i) => (
            <li key={stage} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: STAGE_COLORS[i] }} aria-hidden="true" />
              {t(`widgets.stage.${stage}`)}
            </li>
          ))}
        </ul>
        <DateSpan rows={nights} />
      </>
    );
  }

  const rows = (data?.sleep ?? []).map((s) => ({ date: dayOf(s.end ?? s.start, timeZone), value: s.durationMin / 60 }));
  if (rows.length === 0) return <Empty text={t("widgets.empty.sleep")} />;
  const avg = rows.reduce((a, r) => a + r.value, 0) / rows.length;
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t("widgets.label.averageNight")}</span>
          <Figure value={hm(avg * 60)} unit="h" size="md" />
        </div>
        <Pill tone="primary">{t("widgets.pill.lastNight", { value: `${hm(rows[rows.length - 1]!.value * 60)} h` })}</Pill>
      </div>
      <Bars rows={rows} format={(v) => `${hm(v * 60)} h`} />
      <DateSpan rows={rows} />
    </>
  );
}

/** Hours since 18:00 → local clock hour, two digits. */
const tick = (v: number) => String(Math.round(v + 18) % 24).padStart(2, "0");

/** Bed to wake per night on a 18:00 → 12:00 axis; the figure is how far the sleep midpoint wanders. */
export function SleepScheduleBody(props: BodyProps<"sleep-schedule">) {
  const { data, timeZone } = props;
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const nights = sleepSchedule(sessionsOf(data), timeZone);
  if (nights.length === 0) return <Empty text={t("widgets.empty.sleepSchedule")} />;
  const spread = regularity(nights);
  const bed = nights.reduce((a, n) => a + n.bed, 0) / nights.length;
  const bedClock = hm(Math.round(((bed + 18) % 24) * 60) % 1440);
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t(spread === null ? "widgets.label.averageBedtime" : "widgets.label.regularity")}</span>
          {spread === null ? <Figure value={bedClock} size="md" /> : <Figure value={`±${Math.round(spread)}`} unit="min" size="md" />}
        </div>
        {spread !== null && <Pill>{t("widgets.pill.bedtime", { time: bedClock })}</Pill>}
      </div>
      <RangeBars rows={nights.map((n) => ({ date: n.date, start: n.bed, end: n.wake }))} domain={[0, 18]} ticks={[4, 8, 12, 16]} formatTick={tick} />
      <DateSpan rows={nights} />
    </>
  );
}
