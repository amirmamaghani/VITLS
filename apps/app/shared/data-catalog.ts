import { getMetric } from "@vitls/health-ingest";

import { widgetSchema, type Widget } from "./dashboard";

export type DataGroup = "activity" | "recovery" | "body" | "nutrition" | "intraday";
export const DATA_GROUPS: readonly DataGroup[] = ["activity", "recovery", "body", "nutrition", "intraday"];

const RECOVERY = new Set(["resting_hr", "hrv_rmssd_night", "hrv_sdnn_night", "sleep_duration", "sleep_score", "stress_avg", "spo2_avg", "respiration_avg", "body_battery_high", "body_battery_low", "training_readiness"]);

/** Theme of a catalog metric for the Data page (the catalog itself has no group field). */
export function groupOf(key: string): DataGroup {
  const def = getMetric(key);
  if (def?.kind === "intraday") return "intraday";
  if (key.startsWith("intake_")) return "nutrition";
  if (def?.kind === "point") return "body";
  if (RECOVERY.has(key)) return "recovery";
  return "activity";
}

/** The small card on the Data page and the big chart in the expanded view. */
export function defaultWidget(key: string): Widget {
  const def = getMetric(key);
  return widgetSchema.parse({ id: `data-${key}`, kind: "metric", metric: key, view: def?.kind === "point" ? "trend" : "line", range: "90d" });
}

export const SECTION_WIDGETS: Record<"sleep" | "workouts" | "meals", Widget> = {
  sleep: widgetSchema.parse({ id: "data-sleep", kind: "sleep", view: "duration", range: "90d" }),
  workouts: widgetSchema.parse({ id: "data-workouts", kind: "workouts", range: "90d" }),
  meals: widgetSchema.parse({ id: "data-meals", kind: "meals" }),
};
