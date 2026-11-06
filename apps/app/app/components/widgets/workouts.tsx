import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconActivity, IconBarbell, IconBike, IconRun, IconSwimming, type Icon } from "@tabler/icons-react";

import { Empty, Figure, formatValue, Pill, statusOf } from "./blocks";
import type { BodyProps } from ".";

const WORKOUT_ICONS: [RegExp, Icon][] = [
  [/run|walk|hik/, IconRun],
  [/cycl|bike/, IconBike],
  [/swim/, IconSwimming],
  [/strength|weight|gym/, IconBarbell],
];

export function WorkoutsBody(props: BodyProps<"workouts">) {
  const { data } = props;
  const t = useT();
  const { formatDate } = useFormatters();
  const status = statusOf(props);
  if (status) return status;
    const list = data?.workouts ?? [];
    if (list.length === 0) return <Empty text={t("widgets.empty.workouts")} />;
    const minutes = list.reduce((a, w) => a + w.durationMin, 0);
    return (
      <>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{t("widgets.label.sessions")}</span>
            <Figure value={String(list.length)} size="md" />
          </div>
          <Pill tone="primary">{t("widgets.pill.hoursTotal", { hours: Math.round((minutes / 60) * 10) / 10 })}</Pill>
        </div>
        <ul className="flex flex-col gap-2">
          {[...list].reverse().slice(0, 4).map((w) => {
            const WIcon = WORKOUT_ICONS.find(([re]) => re.test(w.type))?.[1] ?? IconActivity;
            return (
              <li key={w.start} className="flex items-center gap-3 rounded-2xl bg-background px-3 py-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                  <WIcon className="size-4" stroke={1.6} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm capitalize">{w.type.replace(/_/g, " ")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(w.start, { weekday: "short", day: "numeric", month: "short", timeZone: props.timeZone })}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {w.durationMin} min
                  {w.distanceM ? <span className="block text-xs text-muted-foreground">{formatValue("distance", w.distanceM)}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </>
    );
}
