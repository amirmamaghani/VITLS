import { formatParts } from "@/components/widgets";

import type { RawRow } from "../../../server/lib/health/raw";

/** An instant in the user's zone ("2026-10-10 08:25"); day strings pass through. */
export function when(iso: string, timeZone: string | null): string {
  if (!/T/.test(iso)) return iso;
  return new Date(iso).toLocaleString("sv-SE", { timeZone: timeZone ?? undefined, hour12: false }).slice(0, 16);
}

/** The day a row belongs to, in the user's zone. */
export function dayOf(r: RawRow, timeZone: string | null): string {
  if (r.kind === "daily") return r.day;
  if (r.kind === "meal") return r.meal.localDate;
  return when(r.kind === "point" ? r.at : r.start, timeZone).slice(0, 10);
}

/** The row's one number for stats and sorting: the value, or hours slept, workout minutes, meal kcal. */
export function numericOf(r: RawRow): number {
  switch (r.kind) {
    case "daily":
    case "point":
      return r.value;
    case "sleep":
      return r.durationS / 3600;
    case "workout":
      return (Date.parse(r.end) - Date.parse(r.start)) / 60_000;
    case "meal":
      return r.meal.totals.energy ?? 0;
  }
}

/** The row's number as the user reads it ("7,037 steps", "7.5 h", "45 min", "336 kcal"). */
export function displayOf(r: RawRow, key: string): string {
  switch (r.kind) {
    case "daily":
    case "point": {
      const p = formatParts(key, r.value);
      return `${p.value} ${p.unit}`.trim();
    }
    case "sleep":
      return `${numericOf(r).toFixed(1)} h`;
    case "workout":
      return `${Math.round(numericOf(r))} min`;
    case "meal":
      return `${Math.round(numericOf(r))} kcal`;
  }
}

/** Display formatting for a bare number of this metric or section. */
export function formatNumber(key: string, kind: RawRow["kind"], value: number): string {
  if (kind === "daily" || kind === "point") {
    const p = formatParts(key, value);
    return `${p.value} ${p.unit}`.trim();
  }
  if (kind === "sleep") return `${value.toFixed(1)} h`;
  if (kind === "workout") return `${Math.round(value)} min`;
  return `${Math.round(value)} kcal`;
}

export const isWinner = (r: RawRow) => !("winner" in r) || r.winner;
export const sourceOf = (r: RawRow) => (r.kind === "meal" ? { id: "meals", provider: r.meal.source, via: "", label: null } : r.source);
export const sourceName = (s: { provider: string; label: string | null }) => s.label ?? s.provider.replace(/_/g, " ");

/** The detail a row carries beyond its number (sleep stages, workout type, meal items). */
export function detailOf(r: RawRow): string {
  switch (r.kind) {
    case "sleep":
      return Array.isArray(r.stages) ? `${r.stages.length} stages` : "";
    case "workout":
      return [r.type, r.distanceM ? `${(r.distanceM / 1000).toFixed(1)} km` : null, r.energyKcal ? `${Math.round(r.energyKcal)} kcal` : null, r.avgHr ? `${Math.round(r.avgHr)} bpm` : null]
        .filter(Boolean)
        .join(" · ");
    case "meal":
      return r.meal.items.map((i) => i.name).join(", ");
    default:
      return `${r.value} ${r.unit}`;
  }
}

/** Summary over the winning rows: latest with its change, average, min and max with their days. */
export function summarize(rows: RawRow[], timeZone: string | null) {
  const winners = rows.filter(isWinner);
  if (winners.length === 0) return null;
  const values = winners.map(numericOf);
  const latest = winners[0]!;
  const previous = winners[1];
  let min = winners[0]!, max = winners[0]!;
  for (const r of winners) {
    if (numericOf(r) < numericOf(min)) min = r;
    if (numericOf(r) > numericOf(max)) max = r;
  }
  return {
    latest: { value: numericOf(latest), day: dayOf(latest, timeZone), delta: previous ? numericOf(latest) - numericOf(previous) : null },
    average: values.reduce((a, b) => a + b, 0) / values.length,
    min: { value: numericOf(min), day: dayOf(min, timeZone) },
    max: { value: numericOf(max), day: dayOf(max, timeZone) },
    count: rows.length,
    days: new Set(winners.map((r) => dayOf(r, timeZone))).size,
  };
}

/** One flat object per row for CSV. */
export function flatten(r: RawRow): Record<string, unknown> {
  switch (r.kind) {
    case "daily":
      return { kind: r.kind, day: r.day, value: r.value, unit: r.unit, provider: r.source.provider, via: r.source.via, winner: r.winner, updatedAt: r.updatedAt };
    case "point":
      return { kind: r.kind, at: r.at, value: r.value, unit: r.unit, provider: r.source.provider, via: r.source.via, winner: r.winner, updatedAt: r.updatedAt };
    case "sleep":
      return { kind: r.kind, start: r.start, end: r.end, durationS: r.durationS, stages: r.stages, scores: r.scores, provider: r.source.provider, via: r.source.via, updatedAt: r.updatedAt };
    case "workout":
      return { kind: r.kind, start: r.start, end: r.end, type: r.type, distanceM: r.distanceM, energyKcal: r.energyKcal, avgHr: r.avgHr, maxHr: r.maxHr, zones: r.zones, sets: r.sets, provider: r.source.provider, via: r.source.via, updatedAt: r.updatedAt };
    case "meal":
      return { kind: r.kind, eatenAt: r.meal.eatenAt, localDate: r.meal.localDate, mealType: r.meal.mealType, source: r.meal.source, items: r.meal.items.map((i) => `${i.name} ${i.amount} ${i.unit}`).join("; "), energy: r.meal.totals.energy };
  }
}
