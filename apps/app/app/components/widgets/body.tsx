import { useT } from "@agent-native/core/client/i18n";

import { energyBalance, perDay, signed } from "../../../shared/widget-data";
import type { BodyProps } from ".";
import { DivergingBars, DateSpan, Empty, Figure, NoteList, Pill, statusOf } from "./blocks";

const CIRCUMFERENCES = ["waist", "shoulders", "chest", "hips", "neck", "arm", "thigh"] as const;
export const CIRCUMFERENCE_METRICS: string[] = [...CIRCUMFERENCES];
/** Circumferences are stored in metres; one decimal in centimetres without a trailing ".0". */
const cm = (m: number) => String(Number((m * 100).toFixed(1)));

/** Tape measurements: latest per site with the change since the first reading in range, and the V-taper. */
export function CircumferencesBody(props: BodyProps<"circumferences">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const sites = CIRCUMFERENCES.flatMap((key) => {
    const values = props.data?.points?.[key]?.values ?? [];
    return values.length ? [{ key, first: values[0]!.value, latest: values[values.length - 1]!.value, n: values.length }] : [];
  });
  if (sites.length === 0) return <Empty text={t("widgets.empty.circumferences")} />;
  const latest = (key: string) => sites.find((s) => s.key === key)?.latest;
  const taper = latest("shoulders") && latest("waist") ? latest("shoulders")! / latest("waist")! : null;
  return (
    <>
      {taper !== null && (
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{t("widgets.label.vTaper")}</span>
            <Figure value={taper.toFixed(2)} size="md" />
          </div>
          <Pill tone="primary">{t("widgets.label.shouldersOverWaist")}</Pill>
        </div>
      )}
      <NoteList
        items={sites.map((s) => ({
          title: `${t(`widgets.site.${s.key}`)} ${cm(s.latest)} cm`,
          detail: s.n > 1 ? `${signed(Number(cm(s.latest)) - Number(cm(s.first)), 1)} cm` : undefined,
        }))}
      />
    </>
  );
}

/** Intake minus total expenditure per day: deficit days primary, surplus grey. */
export function EnergyBalanceBody(props: BodyProps<"energy-balance">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const byDay = (key: string) => Object.fromEntries(perDay(props.data?.daily?.[key]).map((v) => [v.date, v.value]));
  // Today is partial intake against a full-day expenditure: complete days only.
  const rows = energyBalance(byDay("intake_energy"), byDay("total_energy")).filter((r) => r.date < props.today).map((r) => ({ date: r.date, value: r.balance }));
  if (rows.length === 0) return <Empty text={t("widgets.empty.energyBalance")} />;
  const avg = Math.round(rows.reduce((a, r) => a + r.value, 0) / rows.length);
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t("widgets.label.averageBalance")}</span>
          <Figure value={signed(avg)} unit={t("widgets.unit.kcalPerDay")} size="md" />
        </div>
        <Pill tone={avg < 0 ? "primary" : "plain"}>{t(avg < 0 ? "widgets.balance.deficit" : avg > 0 ? "widgets.balance.surplus" : "widgets.balance.balanced")}</Pill>
      </div>
      <div className="flex max-h-40 min-h-20 flex-1">
        <DivergingBars rows={rows} format={(v) => `${signed(Math.round(v))} kcal`} />
      </div>
      <DateSpan rows={rows} />
    </>
  );
}
