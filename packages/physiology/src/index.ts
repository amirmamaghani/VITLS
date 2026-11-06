/**
 * Deterministic physiology math over platform-reported daily values (decision D8: no body-composition models).
 * The coach interprets these numbers; it never computes them itself.
 */
export interface Point {
  date: string; // YYYY-MM-DD
  value: number;
}

const KCAL_PER_KG_FAT = 7700;
/** Upper bound of real fat change per day (≈ 0.1–0.2 kg); anything faster is water, glycogen or salt. */
const MAX_FAT_KG_PER_DAY = 0.2;

const lastOf = <T>(items: T[]): T | undefined => items[items.length - 1];
const byDate = (points: Point[]) => [...points].sort((a, b) => a.date.localeCompare(b.date));
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (v: number | null, digits = 2) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
/** The points dated within the last `days` calendar days of the series (readings can be sparse, so never count samples). */
const lastDays = (sorted: Point[], days: number) => {
  const end = lastOf(sorted);
  return end ? sorted.filter((p) => daysBetween(p.date, end.date) < days) : [];
};

/**
 * Exponential moving average over calendar time (the "trend" line); alpha 0.15 per day ≈ a 12-day memory.
 * A reading after a gap counts for every day that passed, so the trend forgets a stale level instead of
 * crawling toward a value logged months later.
 */
export function ema(points: Point[], alpha = 0.15): Point[] {
  let trend: number | undefined;
  let previous: string | undefined;
  return byDate(points).map(({ date, value }) => {
    const weight = previous === undefined ? 1 : 1 - (1 - alpha) ** Math.max(1, daysBetween(previous, date));
    trend = trend === undefined ? value : trend + weight * (value - trend);
    previous = date;
    return { date, value: trend };
  });
}

/**
 * One summary for any metric: latest vs trend (offset = water/noise for weight), weekly trend rate,
 * and the last 7 days against the personal baseline (previous up to 53 days, i.e. a 60-day window).
 */
export function summarize(points: Point[], opts: { alpha?: number; recentDays?: number; windowDays?: number } = {}) {
  const { alpha = 0.15, recentDays = 7, windowDays = 60 } = opts;
  const sorted = byDate(points);
  const trend = ema(sorted, alpha);
  const last = lastOf(sorted);
  const lastTrend = lastOf(trend)?.value ?? null;

  // Trend slope over the last 14 days, expressed per week.
  const back = trend[trend.length - Math.min(trend.length, 15)];
  const spanDays = last && back ? (Date.parse(last.date) - Date.parse(back.date)) / 86_400_000 : 0;
  const ratePerWeek = lastTrend !== null && back && spanDays > 0 ? ((lastTrend - back.value) / spanDays) * 7 : null;

  const window = lastDays(sorted, windowDays).map((p) => p.value);
  const recent = mean(lastDays(sorted, recentDays).map((p) => p.value));
  const baseline = mean(window);
  // Population SD of the same baseline window: how much this person normally fluctuates.
  const sd = baseline === null ? null : Math.sqrt(window.reduce((a, v) => a + (v - baseline) ** 2, 0) / window.length);
  const deviationPct = recent !== null && baseline ? ((recent - baseline) / baseline) * 100 : null;

  return {
    days: sorted.length,
    latest: last?.value ?? null,
    latestDate: last?.date ?? null,
    trend: round(lastTrend),
    offset: round(last && lastTrend !== null ? last.value - lastTrend : null),
    ratePerWeek: round(ratePerWeek),
    recent: round(recent),
    baseline: round(baseline),
    sd: round(sd),
    deviationPct: round(deviationPct, 1),
  };
}

/** Is a body-weight change physically plausible as fat? (e.g. +2 kg overnight would need 15,400 kcal surplus.) */
export function fatChangeCheck(deltaKg: number, days: number) {
  const maxPlausibleFatKg = Math.max(days, 1) * MAX_FAT_KG_PER_DAY;
  return {
    kcalRequired: Math.round(Math.abs(deltaKg) * KCAL_PER_KG_FAT),
    maxPlausibleFatKg,
    plausibleAsFat: Math.abs(deltaKg) <= maxPlausibleFatKg,
  };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const pct = (recent: number, baseline: number) => round(((recent - baseline) / baseline) * 100, 1) as number;
const effectOf = (deltaPct: number): "up" | "down" | "flat" => (Math.abs(deltaPct) <= 3 ? "flat" : deltaPct > 0 ? "up" : "down");

interface Vital {
  recent: number | null;
  baseline: number | null;
  days: number;
}

/**
 * Readiness from personal baselines (not population norms). Components, each clamped 0-100:
 * HRV 50 + 2.5 x deltaPct (higher is better), RHR 50 - 4 x deltaPct (lower is better),
 * sleep (hours - 5) / 3 x 100. Score = mean of available components; a platform score (Garmin) wins.
 * Verdict: >= 67 train, >= 40 easy, else rest. enoughHistory = an HRV or RHR baseline built from >= 7 days.
 * Driver deltaPct is recent vs baseline (sleep vs 8 h); within +-3 % counts as flat.
 */
export function readiness(input: { hrv?: Vital; rhr?: Vital; sleepHours?: number | null; platformScore?: number | null }) {
  const drivers: { key: "hrv" | "rhr" | "sleep"; deltaPct: number; effect: "up" | "down" | "flat" }[] = [];
  const parts: number[] = [];
  const add = (key: "hrv" | "rhr" | "sleep", deltaPct: number, score: number) => {
    drivers.push({ key, deltaPct, effect: effectOf(deltaPct) });
    parts.push(clamp(score));
  };

  const { hrv, rhr, sleepHours, platformScore } = input;
  if (hrv && hrv.recent !== null && hrv.baseline) {
    const d = pct(hrv.recent, hrv.baseline);
    add("hrv", d, 50 + 2.5 * d);
  }
  if (rhr && rhr.recent !== null && rhr.baseline) {
    const d = pct(rhr.recent, rhr.baseline);
    add("rhr", d, 50 - 4 * d);
  }
  if (sleepHours !== null && sleepHours !== undefined) add("sleep", pct(sleepHours, 8), ((sleepHours - 5) / 3) * 100);

  const computed = mean(parts);
  const raw = platformScore ?? computed;
  const score = raw === null ? null : Math.round(raw);
  const verdict = score === null ? null : score >= 67 ? "train" : score >= 40 ? "easy" : "rest";
  const built = (v?: Vital) => !!v && v.baseline !== null && v.days >= 7;
  return { score, verdict, drivers, enoughHistory: built(hrv) || built(rhr) } as {
    score: number | null;
    verdict: "train" | "easy" | "rest" | null;
    drivers: typeof drivers;
    enoughHistory: boolean;
  };
}

/** Epley one-rep-max estimate; reps beyond 12 are too unreliable to extrapolate, so they are capped. */
export function estimate1RM(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + Math.min(reps, 12) / 30);
}

/**
 * VO2max (mL/kg/min) at the 10th/30th/50th/70th/90th percentile by sex and age decade 20-29 ... 70-79.
 * Rows approximate the Cooper Institute normative percentile tables as printed in ACSM's Guidelines for
 * Exercise Testing and Prescription (10th ed., "Percentiles for maximal aerobic power", men and women,
 * one row per age band 20-29, 30-39, 40-49, 50-59, 60-69, 70-79); thinned to five points per band.
 * APPROXIMATE: values were reconstructed, not copied - verify against the source before relying on them.
 */
const VO2_PERCENTILES = [10, 30, 50, 70, 90];
const VO2_TABLE: Record<"male" | "female", number[][]> = {
  male: [
    [32.1, 39.5, 43.9, 48.2, 55.4],
    [31.1, 36.7, 40.5, 45.2, 51.1],
    [28.2, 33.5, 36.7, 41.0, 46.8],
    [24.5, 29.4, 33.0, 36.7, 43.0],
    [20.4, 25.3, 28.7, 32.6, 38.1],
    [17.4, 21.8, 24.8, 28.1, 32.9],
  ],
  female: [
    [27.5, 32.0, 36.1, 40.0, 46.5],
    [25.4, 29.7, 33.0, 36.8, 42.4],
    [22.3, 26.6, 29.9, 33.2, 38.4],
    [19.7, 23.7, 26.7, 29.5, 34.6],
    [17.4, 20.9, 23.7, 26.5, 30.8],
    [16.0, 18.4, 20.8, 23.5, 26.9],
  ],
};

/** Percentile (1-99) of a VO2max against age/sex norms; linear between table points, ages outside 20-79 use the nearest decade. */
export function vo2maxPercentile(vo2max: number, age: number, sex: "male" | "female"): number {
  const row = VO2_TABLE[sex][clamp(Math.floor(age / 10) - 2, 0, 5)]!;
  // Interpolate inside the table; outside it, extend the nearest segment's slope (the result is clamped anyway).
  const k = row.findIndex((v) => vo2max < v);
  const i = k === -1 ? row.length - 2 : clamp(k - 1, 0, row.length - 2);
  const [x0, x1, p0, p1] = [row[i]!, row[i + 1]!, VO2_PERCENTILES[i]!, VO2_PERCENTILES[i + 1]!];
  const p = p0 + ((vo2max - x0) / (x1 - x0)) * (p1 - p0);
  return Math.round(clamp(p, 1, 99));
}
