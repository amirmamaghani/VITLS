/**
 * Metric catalog: the single list of metrics VITLS understands.
 * Adding a metric is one entry here — storage is long-format, so no schema change is needed.
 *
 * kind:
 *  - daily:    one value per user-local day (steps, resting HR, ...)
 *  - point:    a measurement at an instant (weigh-in, VO2max estimate, blood pressure)
 *  - intraday: a regular series within a day (heart rate every minute); premium tier only
 */
import { NUTRIENTS } from "./nutrients";

export type MetricKind = "daily" | "point" | "intraday";
export type Tier = "free" | "premium";

export type CanonicalUnit =
  | "count"
  | "m"
  | "kg"
  | "kcal"
  | "s"
  | "ms"
  | "bpm"
  | "brpm"
  | "pct"
  | "score"
  | "ml_kg_min"
  | "mmHg"
  | "years"
  | "g"
  | "mg"
  | "ug"
  | "ml";

export interface MetricDefinition {
  key: string;
  kind: MetricKind;
  unit: CanonicalUnit;
  tier: Tier;
  /** How multiple values for the same day combine when a day is re-aggregated. */
  aggregation: "sum" | "avg" | "min" | "max" | "last";
  description: string;
}

const daily = (key: string, unit: CanonicalUnit, aggregation: MetricDefinition["aggregation"], description: string): MetricDefinition => ({
  key,
  kind: "daily",
  unit,
  tier: "free",
  aggregation,
  description,
});

const point = (key: string, unit: CanonicalUnit, description: string): MetricDefinition => ({
  key,
  kind: "point",
  unit,
  tier: "free",
  aggregation: "last",
  description,
});

const intraday = (key: string, unit: CanonicalUnit, aggregation: MetricDefinition["aggregation"], description: string): MetricDefinition => ({
  key,
  kind: "intraday",
  unit,
  tier: "premium",
  aggregation,
  description,
});

export const METRICS: readonly MetricDefinition[] = [
  // Activity
  daily("steps", "count", "sum", "Steps taken"),
  daily("distance", "m", "sum", "Distance covered on foot"),
  daily("floors", "count", "sum", "Floors climbed"),
  daily("active_energy", "kcal", "sum", "Active energy burned"),
  daily("total_energy", "kcal", "sum", "Total energy burned (BMR + active)"),
  daily("intensity_minutes", "s", "sum", "Moderate/vigorous intensity time"),
  // Recovery
  daily("resting_hr", "bpm", "avg", "Resting heart rate"),
  daily("hrv_rmssd_night", "ms", "avg", "Overnight HRV (RMSSD) average"),
  daily("hrv_sdnn_night", "ms", "avg", "Overnight HRV (SDNN, Apple)"),
  daily("sleep_duration", "s", "sum", "Total sleep time"),
  daily("sleep_score", "score", "last", "Platform sleep score (0-100)"),
  daily("stress_avg", "score", "avg", "Average stress level (platform scale)"),
  daily("spo2_avg", "pct", "avg", "Average blood oxygen saturation"),
  daily("respiration_avg", "brpm", "avg", "Average respiration rate"),
  daily("body_battery_high", "score", "max", "Highest Body Battery (Garmin)"),
  daily("body_battery_low", "score", "min", "Lowest Body Battery (Garmin)"),
  daily("training_readiness", "score", "last", "Training readiness (Garmin)"),
  // Body & fitness (point-in-time)
  point("weight", "kg", "Body weight"),
  point("body_fat_pct", "pct", "Body fat percentage as reported by the platform"),
  point("muscle_mass", "kg", "Muscle mass as reported by the platform"),
  point("body_water_pct", "pct", "Body water percentage as reported by the platform"),
  point("lean_mass", "kg", "Lean body mass as reported by the platform"),
  point("shoulders", "m", "Shoulder circumference (manual)"),
  point("chest", "m", "Chest circumference (manual)"),
  point("hips", "m", "Hip circumference (manual)"),
  point("neck", "m", "Neck circumference (manual)"),
  point("arm", "m", "Arm circumference (manual)"),
  point("thigh", "m", "Thigh circumference (manual)"),
  point("waist", "m", "Waist circumference (usually entered manually; BIA-independent progress check)"),
  point("vo2max", "ml_kg_min", "VO2max estimate"),
  point("blood_pressure_systolic", "mmHg", "Systolic blood pressure"),
  point("blood_pressure_diastolic", "mmHg", "Diastolic blood pressure"),
  point("fitness_age", "years", "Fitness age estimate"),
  // Intraday (premium)
  intraday("heart_rate", "bpm", "avg", "Heart rate series"),
  intraday("stress", "score", "avg", "Stress level series"),
  intraday("body_battery", "score", "last", "Body Battery series (Garmin)"),
  intraday("step_count", "count", "sum", "Steps per interval"),
  intraday("spo2", "pct", "avg", "Blood oxygen series"),
  intraday("respiration", "brpm", "avg", "Respiration rate series"),
  // Nutrition intake (docs/design/06-nutrition.md §3): daily totals recomputed from the food log.
  ...NUTRIENTS.map((x) => daily(`intake_${x.key}`, x.unit, "sum", `${x.label} eaten (food log)`)),
];

const byKey = new Map(METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): MetricDefinition | undefined {
  return byKey.get(key);
}

export function metricsOfKind(kind: MetricKind): MetricDefinition[] {
  return METRICS.filter((m) => m.kind === kind);
}
