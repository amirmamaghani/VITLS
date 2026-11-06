import { useT } from "@agent-native/core/client/i18n";

import { calendarGrid, perDay } from "../../../shared/widget-data";
import type { BodyProps } from ".";
import { Bars, DateSpan, Empty, Heatmap, Stat, statusOf } from "./blocks";

/** Twelve weeks of training minutes, one square per day. */
export function CalendarBody(props: BodyProps<"calendar">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const grid = calendarGrid(props.data?.workouts ?? [], props.today, props.timeZone);
  const active = grid.filter((d) => d.minutes > 0).length;
  if (active === 0) return <Empty text={t("widgets.empty.workouts")} />;
  return (
    <>
      <Stat label={t("widgets.label.activeDays")} value={String(active)} unit={t("widgets.label.ofTotal", { total: grid.filter((d) => d.date <= props.today).length })} size="lg" tone="plain" />
      <Heatmap cells={grid.map((d) => ({ date: d.date, value: d.minutes || null }))} format={(v) => t("widgets.unit.minutes", { count: Math.round(v) })} />
    </>
  );
}

/** Average daily energy expenditure and the share spent actively. */
export function TdeeBody(props: BodyProps<"tdee">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  // Today is partial: complete days only.
  const total = perDay(props.data?.daily?.total_energy).filter((v) => v.date < props.today);
  if (total.length === 0) return <Empty text={t("widgets.empty.energy")} />;
  const avg = (values: { value: number }[]) => values.reduce((a, v) => a + v.value, 0) / values.length;
  const active = perDay(props.data?.daily?.active_energy).filter((v) => v.date < props.today);
  const share = active.length ? Math.round((avg(active) / avg(total)) * 100) : null;
  return (
    <>
      <Stat label={t("widgets.label.averagePerDay")} value={Math.round(avg(total)).toLocaleString()} unit="kcal" pill={share === null ? undefined : t("widgets.pill.activeShare", { percent: share })} size="lg" />
      <Bars rows={total} format={(v) => `${Math.round(v)} kcal`} />
      <DateSpan rows={total} />
    </>
  );
}
