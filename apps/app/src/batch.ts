/**
 * Shared shape of what a platform health store yields for one sync window, and the small
 * helpers both platforms need to turn raw samples into the VITLS ingest contract.
 */
import type { IngestBatchInput } from "@vitls/health-ingest";

export type Daily = NonNullable<IngestBatchInput["daily"]>[number];
type Point = NonNullable<IngestBatchInput["points"]>[number];
export type Sleep = NonNullable<IngestBatchInput["sleep"]>[number];
type Workout = NonNullable<IngestBatchInput["workouts"]>[number];
export type Series = NonNullable<IngestBatchInput["intraday"]>[number];
export type Stage = Sleep["stages"] extends (infer S)[] | undefined ? S : never;

export interface HealthData {
  daily: Daily[];
  points: Point[];
  intraday?: Series[];
  sleep: Sleep[];
  workouts: Workout[];
}

/** Calendar day in the device's time zone (ingest wants user-local days). */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Folds raw (date, value) samples into one daily item per local day. */
export function rollupDaily(metric: string, unit: string, samples: { date: Date; value: number }[], agg: "sum" | "avg"): Daily[] {
  const days = new Map<string, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.value)) continue;
    const day = localDay(s.date);
    days.set(day, [...(days.get(day) ?? []), s.value]);
  }
  return [...days].map(([date, values]) => ({
    externalId: `${metric}:${date}`,
    date,
    metric,
    unit,
    value: agg === "sum" ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length,
  }));
}

/** Groups ordered sleep stages into sessions: a gap longer than `gapMs` starts a new session. */
export function sessionsFromStages(stages: (Stage & { id: string })[], gapMs = 3_600_000): Sleep[] {
  const sorted = [...stages].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const sessions: Sleep[] = [];
  for (const { id, ...stage } of sorted) {
    const last = sessions.at(-1);
    if (last && Date.parse(stage.start) - Date.parse(last.end) <= gapMs) {
      last.end = stage.end > last.end ? stage.end : last.end;
      last.stages!.push(stage);
    } else {
      sessions.push({ externalId: id, start: stage.start, end: stage.end, stages: [stage] });
    }
  }
  return sessions;
}

/** Places irregular samples on a fixed grid per local day (one intraday series per day); gaps become null. */
export function toSeries(metric: string, unit: string, samples: { date: Date; value: number }[], intervalSec: number): Series[] {
  const days = new Map<string, { date: Date; value: number }[]>();
  for (const s of samples) days.set(localDay(s.date), [...(days.get(localDay(s.date)) ?? []), s]);
  return [...days.values()].map((list) => {
    const sorted = list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const start = sorted[0]!.date.getTime();
    const step = intervalSec * 1000;
    const values: (number | null)[] = new Array(Math.round((sorted.at(-1)!.date.getTime() - start) / step) + 1).fill(null);
    for (const s of sorted) values[Math.round((s.date.getTime() - start) / step)] = s.value;
    return { metric, unit, start: new Date(start).toISOString(), intervalSec, values };
  });
}
