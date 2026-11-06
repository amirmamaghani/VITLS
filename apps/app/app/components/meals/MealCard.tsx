import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconDots, IconToolsKitchen2 } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Figure, IconBadge, Pill } from "@/components/widgets";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { sumNutrients, type MealView } from "../../../shared/meals";

const MACROS = [
  ["protein", "Protein"],
  ["carbs", "Carbs"],
  ["fat", "Fat"],
] as const;

/**
 * One meal: items with amounts and the meal's macros. Shared by chat (log-meal result), /food and the meals widget
 * (docs/design/06-nutrition.md §8). Editing an amount rescales that item locally at once, then saves through log-meal.
 */
export function MealCard({ meal: initial }: { meal: MealView }) {
  const [meal, setMeal] = useState(initial);
  const [deleted, setDeleted] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const latest = useRef(0);
  const save = useActionMutation("log-meal");
  const remove = useActionMutation("delete-meal");
  if (deleted) return null;

  const setAmount = (index: number, amount: number) => {
    if (!(amount > 0)) return;
    const items = meal.items.map((item, i) => {
      if (i !== index) return item;
      const factor = amount / item.amount;
      return { ...item, amount, nutrients: Object.fromEntries(Object.entries(item.nutrients).map(([k, v]) => [k, Math.round((v as number) * factor * 100) / 100])) };
    });
    const previous = meal;
    setMeal({ ...meal, items, totals: sumNutrients(items.map((i) => i.nutrients)) });
    const request = ++latest.current;
    save
      .mutateAsync({ mealId: meal.id, items: items.map((i) => (i.foodId ? { foodId: i.foodId, amount: i.amount, unit: i.unit } : { name: i.name, amount: i.amount, unit: i.unit, nutrients: i.nutrients, estimated: i.estimated })) } as never)
      .then((result) => {
        if (request !== latest.current) return;
        const saved = (result as { meal?: MealView } | undefined)?.meal;
        if (saved) setMeal(saved);
        setStatus(null);
      })
      .catch(() => {
        if (request !== latest.current) return;
        setMeal(previous);
        setStatus({ text: "Could not save the amount.", error: true });
      });
  };

  const time = new Date(meal.eatenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Card className="widget-tint flex flex-col gap-4 p-5">
      <header className="flex items-center gap-3">
        <IconBadge icon={IconToolsKitchen2} />
        <h3 className="min-w-0 flex-1 truncate text-base capitalize">{meal.mealType ?? "Meal"}</h3>
        <Pill>{time}</Pill>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full bg-background" aria-label="Meal options">
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() =>
                  save
                    .mutateAsync({ fromMealId: meal.id } as never)
                    .then(() => setStatus({ text: "Repeated" }))
                    .catch(() => setStatus({ text: "Could not repeat the meal.", error: true }))
                }
              >
                Repeat now
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setDeleted(true);
                  remove.mutateAsync({ mealId: meal.id } as never).catch(() => {
                    setDeleted(false);
                    setStatus({ text: "Could not delete the meal.", error: true });
                  });
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="flex flex-1 flex-col justify-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Energy</span>
          <Figure value={Math.round(meal.totals.energy ?? 0).toLocaleString()} unit="kcal" size="md" />
        </div>
        <div className="flex flex-wrap gap-2">
          {MACROS.filter(([k]) => meal.totals[k] !== undefined).map(([k, label]) => (
            <Pill key={k} tone={k === "protein" ? "primary" : "plain"}>
              {label} {Math.round(meal.totals[k]!)} g
            </Pill>
          ))}
        </div>
        <ul className="flex flex-col gap-2">
          {meal.items.map((item, i) => (
            <li key={`${i}:${item.amount}`} className="flex items-center justify-between gap-3 rounded-2xl bg-background px-4 py-2 text-sm">
              <span className="min-w-0 truncate">
                {item.name}
                {item.estimated && <span className="text-muted-foreground"> · est.</span>}
              </span>
              <label className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  defaultValue={item.amount}
                  aria-label={`${item.name} amount in ${item.unit}`}
                  className="h-8 w-20 rounded-full text-right"
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value === item.amount) return;
                    if (value > 0) setAmount(i, value);
                    else e.currentTarget.value = String(item.amount);
                  }}
                />
                {item.unit}
              </label>
            </li>
          ))}
        </ul>
        {status && (
          <p role="status" className={`text-xs ${status.error ? "text-destructive" : "text-muted-foreground"}`}>
            {status.text}
          </p>
        )}
      </div>
    </Card>
  );
}
