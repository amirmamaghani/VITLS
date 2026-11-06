/** The companion's three device-token endpoints besides ingest (spec §2, §6). */
import { request, type State } from "./sync";

export interface TodayView {
  date: string;
  readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;
  metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
  lastBatchAt: string | null;
  missing: string[];
}

export const getToday = (state: State) => request<TodayView>(state, "GET", "/api/devices/today");
export const quickLog = (state: State, entries: { metric: string; value: number; unit?: string; date: string }[]) =>
  request<{ stored: number }>(state, "POST", "/api/devices/log", { entries });
export const registerPush = (state: State, expoToken: string, label?: string) =>
  request<{ ok: true }>(state, "POST", "/api/devices/push", { expoToken, label });

/** One line per goal metric the server reports as missing (TodayView.missing). */
export const MISSING_HINTS: Record<string, string> = {
  vo2max: "VO2max: Garmin Connect › Settings › Health Connect › enable VO2max; Apple Watch writes it automatically.",
  hrv_rmssd_night: "HRV: Garmin does not export HRV to Health Connect; Apple Watch and Oura do.",
  sleep_score: "Sleep score stays inside the vendor app; sleep stages are synced instead.",
  training_readiness: "Training readiness is Garmin-only and is not exported.",
  intensity_minutes: "Intensity minutes are not exported by Garmin; workouts are.",
  body_fat_pct: "Body fat: a smart scale app that writes to Health Connect / Apple Health.",
  muscle_mass: "Muscle mass: a smart scale app that writes lean mass to Health Connect / Apple Health.",
};
