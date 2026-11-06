import { useT } from "@agent-native/core/client/i18n";

import type { BodyProps } from ".";
import { Empty, Figure, Pill, statusOf } from "./blocks";

/** Today's meals as compact rows: type and time, energy, protein. Editing happens on /food. */
export function MealsBody(props: BodyProps<"meals">) {
  const t = useT();
  const status = statusOf(props);
  if (status) return status;
  const meals = [...(props.data?.meals ?? [])].sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
  if (meals.length === 0) return <Empty text={t("widgets.empty.meals")} />;
  return (
    <ul className="flex flex-col gap-2">
      {meals.map((m) => (
        <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-background px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm capitalize">{m.mealType ?? t("widgets.label.meal")}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">{new Date(m.eatenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: props.timeZone })}</span>
          </span>
          <Figure value={Math.round(m.totals.energy ?? 0).toLocaleString()} unit="kcal" size="md" />
          <Pill tone="primary">{t("widgets.pill.protein", { grams: Math.round(m.totals.protein ?? 0) })}</Pill>
        </li>
      ))}
    </ul>
  );
}
