import { useT } from "@agent-native/core/client/i18n";

import { RANGES } from "../../../shared/dashboard";
import { liftSeries, muscleVolume, personalRecords } from "../../../shared/widget-data";
import type { BodyProps } from ".";
import { DateSpan, Empty, NoteList, Pill, Stat, statusOf, useDay, Wave } from "./blocks";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Estimated one-rep max of one exercise over time. */
export function LiftBody(props: BodyProps<"lift">) {
  const t = useT();
  const day = useDay();
  const status = statusOf(props);
  if (status) return status;
  const rows = liftSeries(props.data?.workouts ?? [], props.widget.exercise, props.timeZone);
  if (rows.length === 0) return <Empty text={t("widgets.empty.lift", { exercise: props.widget.exercise })} />;
  const best = rows.reduce((a, r) => (r.e1rm > a.e1rm ? r : a));
  const wave = rows.map((r) => ({ date: r.date, value: r.e1rm }));
  return (
    <>
      <Stat label={t("widgets.label.best1rm")} value={String(best.e1rm)} unit="kg" pill={`PR ${day(best.date)}`} size="lg" />
      {wave.length > 1 && <Wave rows={wave} format={(v) => `${v} kg`} />}
      <DateSpan rows={wave} />
    </>
  );
}

/** Hard sets per muscle and week against the 10–20 guideline. */
const GUIDE = { low: 10, high: 20 };
export function MuscleVolumeBody(props: BodyProps<"muscle-volume">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const workouts = props.data?.workouts ?? [];
  const rows = muscleVolume(workouts, Math.round(RANGES[props.widget.range] / 7)).slice(0, 8);
  if (rows.length === 0) return <Empty text={t("widgets.empty.sets")} />;
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm text-muted-foreground">{t("widgets.label.setsPerWeek")}</span>
        <Pill>{t("widgets.pill.guideline", { low: GUIDE.low, high: GUIDE.high })}</Pill>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.muscle} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 truncate">{sentence(r.muscle)}</span>
            <span role="img" aria-label={t("widgets.a11y.setsPerWeek", { count: r.sets })} className="relative h-2 flex-1 rounded-full bg-muted-foreground/15">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (r.sets / GUIDE.high) * 100)}%`, background: r.sets >= GUIDE.low ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)" }} />
              <span className="absolute -inset-y-0.5 w-px bg-foreground/40" style={{ left: `${(GUIDE.low / GUIDE.high) * 100}%` }} aria-hidden="true" />
            </span>
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{r.sets}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The five heaviest estimated lifts. */
export function PrsBody(props: BodyProps<"prs">) {
  const t = useT();
  const day = useDay();
  const status = statusOf(props);
  if (status) return status;
  const prs = personalRecords(props.data?.workouts ?? [], props.timeZone);
  if (prs.length === 0) return <Empty text={t("widgets.empty.lifts")} />;
  return <NoteList items={prs.map((p) => ({ title: sentence(p.exercise), detail: `${p.e1rm} kg · ${day(p.date)}` }))} />;
}
