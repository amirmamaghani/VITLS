/**
 * Pure aggregations behind the catalog widgets: `get-health` results in, what each widget draws out.
 * Day and week keys are the YYYY-MM-DD strings from the data; date math is whole days in UTC (weeks start Monday).
 * Every function returns an empty array / null for empty input and never NaN.
 */
import { toIdentifier } from "@vitls/health-ingest";
import { estimate1RM } from "@vitls/physiology";

const DAY_MS = 86_400_000;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const key = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => key(ms(day) + n * DAY_MS);
/** `days` local days ending `tail` days after `today` (tail 1 = the query bound that also reaches time-stamped rows of the last local day, whose UTC day may be tomorrow). */
export const rangeOf = (days: number, today: string, tail = 0) => ({ from: addDays(today, 1 - days), to: addDays(today, tail) });
/** Sign-prefixed number with a true minus; a value that rounds to zero gets no sign. */
export const signed = (n: number, digits = 0) => {
  const text = Math.abs(n).toFixed(digits);
  return `${Number(text) === 0 ? "" : n < 0 ? "−" : "+"}${text}`;
};
/** Days in the rolling personal-normal window of the band view (HRV-status style, about four weeks). */
export const BAND_WINDOW_DAYS = 28;
/**
 * Rolling personal normal range: for each day, mean ± 1 SD of the readings in the `window` days before it (the day
 * itself excluded, so an outlier stands out). Null until `min` readings exist.
 */
export function rollingBand(rows: { date: string; value: number }[], window = BAND_WINDOW_DAYS, min = 14) {
  return rows.map((r) => {
    const start = addDays(r.date, -window);
    const prior = rows.filter((p) => p.date >= start && p.date < r.date).map((p) => p.value);
    if (prior.length < min) return { ...r, low: null, high: null };
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
    const sd = Math.sqrt(prior.reduce((a, v) => a + (v - mean) ** 2, 0) / prior.length);
    return { ...r, low: mean - sd, high: mean + sd };
  });
}
/** Monday of the ISO week containing `day`. */
const weekStart = (day: string) => addDays(day, -((new Date(ms(day)).getUTCDay() + 6) % 7));
/** Local YYYY-MM-DD of an instant in `timeZone` (UTC when the zone is invalid). */
export const dayOf = (iso: string, timeZone = "UTC") => {
  const at = new Date(iso);
  try {
    return at.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return at.toLocaleDateString("en-CA", { timeZone: "UTC" });
  }
};
/** Local clock time of an instant as decimal hours (0–24). */
const clockHours = (iso: string, timeZone = "UTC") => {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone }).formatToParts(new Date(iso));
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "UTC" }).formatToParts(new Date(iso));
  }
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return n("hour") + n("minute") / 60;
};
const normExercise = (name: string) => toIdentifier(name);
const humanise = (name: string) => name.replace(/_/g, " ");
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export interface WorkoutSet { exercise: string; reps?: number; weightKg?: number; durationS?: number; muscle?: string | null }
export interface WorkoutRow {
  type: string;
  start: string;
  durationMin: number;
  distanceM?: number;
  energyKcal?: number;
  zones?: { zone: number; seconds: number }[];
  sets?: WorkoutSet[];
  poolLengthM?: number;
  strokes?: number;
}
export interface SleepRow { start: string; end: string; durationMin: number; stageMinutes?: Record<string, number> }
export type Sport = "run" | "ride" | "swim" | "all";

/** Workout-type substrings per sport (undefined = every workout): the one list behind the client filter and the get-health `workoutTypes` param. */
export const SPORT_TYPES: Record<Sport, string[] | undefined> = { run: ["run"], ride: ["cycl", "ride", "bik"], swim: ["swim"], all: undefined };
const inSport = (w: WorkoutRow, sport: Sport) => SPORT_TYPES[sport]?.some((t) => w.type.toLowerCase().includes(t)) ?? true;

// ── Streaks and calendar ────────────────────────────────────────────────────

/** Consecutive ok days ending today (or yesterday while today is still open) + a 4-week Monday-aligned grid. */
export function streakDays(days: { date: string; ok: boolean }[], today: string) {
  const byDate = new Map(days.map((d) => [d.date, d.ok]));
  let cursor = byDate.get(today) === true ? today : addDays(today, -1);
  let current = 0;
  while (byDate.get(cursor) === true) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const start = addDays(weekStart(today), -21);
  const grid = Array.from({ length: 28 }, (_, i) => {
    const date = addDays(start, i);
    return { date, ok: date > today ? null : (byDate.get(date) ?? null) };
  });
  return { current, grid };
}

/** 12 Monday-aligned weeks (84 days, the last week being this one) of training minutes. */
export function calendarGrid(workouts: WorkoutRow[], today: string, timeZone = "UTC"): { date: string; minutes: number }[] {
  const start = addDays(weekStart(today), -77);
  const minutes = new Map<string, number>();
  for (const w of workouts) {
    const d = dayOf(w.start, timeZone);
    minutes.set(d, (minutes.get(d) ?? 0) + w.durationMin);
  }
  return Array.from({ length: 84 }, (_, i) => {
    const date = addDays(start, i);
    return { date, minutes: minutes.get(date) ?? 0 };
  });
}

// ── Training ────────────────────────────────────────────────────────────────

export function zoneTotals(workouts: WorkoutRow[]): { zone: number; seconds: number }[] {
  const totals = new Map<number, number>();
  for (const w of workouts) for (const z of w.zones ?? []) totals.set(z.zone, (totals.get(z.zone) ?? 0) + z.seconds);
  return [...totals].map(([zone, seconds]) => ({ zone, seconds })).sort((a, b) => a.zone - b.zone);
}

/** Share of time in zones 1–2 (0–1; zone 0 / rest is not easy training); null without zone data. */
export function easyShare(totals: { zone: number; seconds: number }[]): number | null {
  const all = totals.reduce((a, t) => a + t.seconds, 0);
  return all > 0 ? totals.filter((t) => t.zone >= 1 && t.zone <= 2).reduce((a, t) => a + t.seconds, 0) / all : null;
}

export interface WeekRange { from?: string; to?: string }

/** Monday keys from the first to the last week, widened to `range` (YYYY-MM-DD local days) when given. */
function weekSpan(present: string[], range?: WeekRange): string[] {
  if (!present.length) return [];
  const sorted = [...present].sort();
  const first = range?.from ? weekStart(range.from) : sorted[0]!;
  const last = range?.to ? weekStart(range.to) : sorted[sorted.length - 1]!;
  const out: string[] = [];
  for (let wk = first < sorted[0]! ? first : sorted[0]!; wk <= (last > sorted[sorted.length - 1]! ? last : sorted[sorted.length - 1]!); wk = addDays(wk, 7)) out.push(wk);
  return out;
}

/** Per ISO week; weeks without a session are zero (across `range` when given, else between first and last session). */
export function weeklyVolume(workouts: WorkoutRow[], sport: Sport, timeZone = "UTC", range?: WeekRange): { week: string; distanceM: number; minutes: number }[] {
  const weeks = new Map<string, { distanceM: number; minutes: number }>();
  for (const w of workouts.filter((x) => inSport(x, sport))) {
    const wk = weekStart(dayOf(w.start, timeZone));
    const cur = weeks.get(wk) ?? { distanceM: 0, minutes: 0 };
    weeks.set(wk, { distanceM: cur.distanceM + (w.distanceM ?? 0), minutes: cur.minutes + w.durationMin });
  }
  return weekSpan([...weeks.keys()], range).map((week) => ({ week, ...(weeks.get(week) ?? { distanceM: 0, minutes: 0 }) }));
}

/** Longest single session per week; sparse unless `range` is given (then zero-filled like weeklyVolume). */
export function longestPerWeek(workouts: WorkoutRow[], sport: Sport, timeZone = "UTC", range?: WeekRange): { week: string; distanceM: number }[] {
  const weeks = new Map<string, number>();
  for (const w of workouts.filter((x) => inSport(x, sport) && (x.distanceM ?? 0) > 0)) {
    const wk = weekStart(dayOf(w.start, timeZone));
    weeks.set(wk, Math.max(weeks.get(wk) ?? 0, w.distanceM!));
  }
  const keys = range ? weekSpan([...weeks.keys()], range) : [...weeks.keys()].sort();
  return keys.map((week) => ({ week, distanceM: weeks.get(week) ?? 0 }));
}

export function swimStats(workouts: WorkoutRow[], timeZone = "UTC"): { date: string; pacePer100s: number; swolf: number | null }[] {
  return workouts
    .filter((w) => inSport(w, "swim") && (w.distanceM ?? 0) > 0 && w.durationMin > 0)
    .map((w) => {
      const seconds = w.durationMin * 60;
      const lengths = w.poolLengthM && w.strokes ? w.distanceM! / w.poolLengthM : 0;
      return {
        date: dayOf(w.start, timeZone),
        pacePer100s: round(seconds / (w.distanceM! / 100)),
        swolf: lengths > 0 ? round((seconds + w.strokes!) / lengths) : null,
      };
    });
}

const setE1rm = (s: WorkoutSet) => (s.weightKg && s.reps ? estimate1RM(s.weightKg, s.reps) : null);

/** Best estimated 1RM per day for one exercise. */
export function liftSeries(workouts: WorkoutRow[], exercise: string, timeZone = "UTC"): { date: string; e1rm: number }[] {
  const best = new Map<string, number>();
  const wanted = normExercise(exercise);
  for (const w of workouts) {
    const day = dayOf(w.start, timeZone);
    for (const s of w.sets ?? []) {
      const e = normExercise(s.exercise) === wanted ? setE1rm(s) : null;
      if (e !== null) best.set(day, Math.max(best.get(day) ?? 0, e));
    }
  }
  return [...best].map(([date, e1rm]) => ({ date, e1rm: round(e1rm) })).sort((a, b) => a.date.localeCompare(b.date));
}

/** The five heaviest estimated 1RMs, one per exercise (names humanised). */
export function personalRecords(workouts: WorkoutRow[], timeZone = "UTC"): { exercise: string; e1rm: number; date: string }[] {
  const best = new Map<string, { exercise: string; e1rm: number; date: string }>();
  for (const w of workouts)
    for (const s of w.sets ?? []) {
      const e = setE1rm(s);
      const id = normExercise(s.exercise);
      if (e !== null && e > (best.get(id)?.e1rm ?? 0)) best.set(id, { exercise: humanise(id), e1rm: round(e), date: dayOf(w.start, timeZone) });
    }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm).slice(0, 5);
}

/** Sets per muscle, averaged per week over `weeks` (the widget range in weeks, at least 1). */
export function muscleVolume(workouts: WorkoutRow[], weeks: number): { muscle: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const w of workouts)
    for (const s of w.sets ?? []) {
      const m = s.muscle ?? "other";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  const span = Math.max(1, weeks);
  return [...counts].map(([muscle, n]) => ({ muscle, sets: round(n / span) })).sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
}

// ── Body and recovery ───────────────────────────────────────────────────────

/** One value per day from a daily series; weekly/monthly buckets (a year's read) become per-day averages. */
export const perDay = (entry?: { values: { date: string; value: number }[]; buckets?: { date: string; value: number; days?: number }[] }) =>
  entry?.buckets ? entry.buckets.map((b) => ({ date: b.date, value: b.days ? b.value / b.days : b.value })) : (entry?.values ?? []);

/** Intake minus total expenditure (kcal) on days that have both. */
export function energyBalance(dailyIntake: Record<string, number>, dailyTotal: Record<string, number>): { date: string; balance: number }[] {
  return Object.keys(dailyIntake)
    .filter((d) => d in dailyTotal)
    .sort()
    .map((date) => ({ date, balance: round(dailyIntake[date]! - dailyTotal[date]!) }));
}

/** Stage minutes by wake date; "unknown" counts as light. */
export function sleepStages(sessions: SleepRow[], timeZone = "UTC"): { date: string; deep: number; rem: number; light: number; awake: number }[] {
  const rows = new Map<string, { date: string; deep: number; rem: number; light: number; awake: number }>();
  for (const s of sessions) {
    const date = dayOf(s.end, timeZone);
    const r = rows.get(date) ?? { date, deep: 0, rem: 0, light: 0, awake: 0 };
    const st = s.stageMinutes ?? {};
    r.deep += st.deep ?? 0;
    r.rem += st.rem ?? 0;
    r.light += (st.light ?? 0) + (st.unknown ?? 0);
    r.awake += st.awake ?? 0;
    rows.set(date, r);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bed and wake as local hours since 18:00 of the evening the night began (23:30 → 5.5, 07:00 next day → 13,
 * 01:00 → 7). Longest session per local wake date.
 */
export function sleepSchedule(sessions: SleepRow[], timeZone = "UTC"): { date: string; bed: number; wake: number }[] {
  const longest = new Map<string, SleepRow>();
  for (const s of sessions) {
    const d = dayOf(s.end, timeZone);
    if (s.durationMin > (longest.get(d)?.durationMin ?? 0)) longest.set(d, s);
  }
  return [...longest]
    .map(([date, s]) => {
      const bedClock = clockHours(s.start, timeZone);
      const bedDay = dayOf(s.start, timeZone);
      const evening = bedClock < 18 ? addDays(bedDay, -1) : bedDay;
      const bed = bedClock < 18 ? bedClock + 6 : bedClock - 18;
      const wake = ((ms(date) - ms(evening)) / DAY_MS) * 24 + clockHours(s.end, timeZone) - 18;
      return { date, bed: round(bed, 2), wake: round(wake, 2) };
    })
    .filter((r) => Number.isFinite(r.bed) && Number.isFinite(r.wake))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** SD of the sleep midpoint in minutes; null under 3 nights. */
export function regularity(rows: { bed: number; wake: number }[]): number | null {
  if (rows.length < 3) return null;
  const mids = rows.map((r) => ((r.bed + r.wake) / 2) * 60);
  const mean = mids.reduce((a, b) => a + b, 0) / mids.length;
  return round(Math.sqrt(mids.reduce((a, m) => a + (m - mean) ** 2, 0) / mids.length), 1);
}

/** Metrics whose recent value deviates from baseline by at least `threshold` %, biggest first (max 6). */
export function anomalies(daily: Record<string, { summary?: { deviationPct?: number | null } }>, threshold: number): { metric: string; deviationPct: number }[] {
  return Object.entries(daily)
    .flatMap(([metric, d]) => (typeof d.summary?.deviationPct === "number" && Math.abs(d.summary.deviationPct) >= threshold ? [{ metric, deviationPct: d.summary.deviationPct }] : []))
    .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct))
    .slice(0, 6);
}
