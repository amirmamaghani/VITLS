import { useT } from "@agent-native/core/client/i18n";

import { cn } from "@/lib/utils";

import type { BodyProps } from ".";
import { Empty, Pill, Ring, RING, statusOf } from "./blocks";

export const MACRO_METRICS = ["intake_energy", "intake_protein", "intake_carbs", "intake_fat"];
const MACROS = [
  { key: "intake_protein", label: "widgets.macro.protein", kcalPerG: 4, color: RING.primary, dot: "bg-primary" },
  { key: "intake_carbs", label: "widgets.macro.carbs", kcalPerG: 4, color: RING.light, dot: "border border-foreground/40 bg-background" },
  { key: "intake_fat", label: "widgets.macro.fat", kcalPerG: 9, color: RING.muted, dot: "bg-muted-foreground/40" },
];

/** Today's macro split by energy share: protein coral, carbs light, fat muted; kcal in the middle. */
export function MacrosBody(props: BodyProps<"macros">) {
  const { data } = props;
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const today = (key: string) => {
    const values = data?.daily?.[key]?.values ?? [];
    return values[values.length - 1]?.value;
  };
  const grams = MACROS.map((m) => ({ ...m, g: today(m.key) ?? 0 }));
  const kcalFromMacros = grams.reduce((a, m) => a + m.g * m.kcalPerG, 0);
  if (kcalFromMacros === 0) return <Empty text={t("widgets.empty.macros")} />;
  const kcal = today("intake_energy") ?? kcalFromMacros;
  return (
    <>
      <div className="flex flex-1 items-center justify-center">
        <Ring segments={grams.map((m) => ({ fraction: (m.g * m.kcalPerG) / kcalFromMacros, color: m.color }))} value={Math.round(kcal).toLocaleString()} label="kcal" />
      </div>
      <ul className="flex flex-wrap justify-center gap-2">
        {grams.map((m) => (
          <li key={m.key}>
            <Pill>
              <span className={cn("mr-2 size-2 rounded-full", m.dot)} aria-hidden="true" />
              {t(m.label)} {Math.round(m.g)} g
            </Pill>
          </li>
        ))}
      </ul>
    </>
  );
}
