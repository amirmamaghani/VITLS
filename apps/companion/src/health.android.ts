/** Health Connect reader: permissions + one sync window → VITLS ingest items. */
import {
  ExerciseType,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  SleepStageType,
  type RecordType,
} from "react-native-health-connect";

import { rollupDaily, toSeries, type HealthData, type Stage } from "./batch";

export const provider = "health_connect" as const;

const RECORDS = [
  "Steps", "Distance", "FloorsClimbed", "ActiveCaloriesBurned", "TotalCaloriesBurned",
  "RestingHeartRate", "HeartRateVariabilityRmssd", "HeartRate", "OxygenSaturation", "RespiratoryRate",
  "Weight", "BodyFat", "LeanBodyMass", "Vo2Max", "SleepSession", "ExerciseSession",
] as const satisfies readonly RecordType[];
const STAGE: Partial<Record<number, Stage["stage"]>> = {
  [SleepStageType.AWAKE]: "awake",
  [SleepStageType.SLEEPING]: "unknown",
  [SleepStageType.LIGHT]: "light",
  [SleepStageType.DEEP]: "deep",
  [SleepStageType.REM]: "rem",
};
const EXERCISE = Object.fromEntries(Object.entries(ExerciseType).map(([name, code]) => [code, name.toLowerCase()]));

export async function requestAccess(): Promise<boolean> {
  if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE || !(await initialize())) return false;
  const granted = await requestPermission([
    ...RECORDS.map((recordType) => ({ accessType: "read" as const, recordType })),
    { accessType: "read", recordType: "BackgroundAccessPermission" },
  ]);
  return granted.some((p) => p.recordType !== "BackgroundAccessPermission");
}

export async function read(startDate: Date, endDate: Date): Promise<HealthData> {
  await initialize();
  const all = async <T extends RecordType>(recordType: T) => {
    const options = { timeRangeFilter: { operator: "between" as const, startTime: startDate.toISOString(), endTime: endDate.toISOString() } };
    const out = [];
    for (let pageToken: string | undefined; ; ) {
      const page = await readRecords(recordType, { ...options, pageToken }).catch(() => ({ records: [], pageToken: undefined })); // not granted → empty
      out.push(...page.records);
      if (!(pageToken = page.pageToken)) return out;
    }
  };
  const [steps, distance, floors, active, total, restingHr, hrv, hr, spo2, resp, weight, bodyFat, leanMass, vo2, sleep, exercise] = await Promise.all([
    all("Steps"), all("Distance"), all("FloorsClimbed"), all("ActiveCaloriesBurned"), all("TotalCaloriesBurned"),
    all("RestingHeartRate"), all("HeartRateVariabilityRmssd"), all("HeartRate"), all("OxygenSaturation"), all("RespiratoryRate"),
    all("Weight"), all("BodyFat"), all("LeanBodyMass"), all("Vo2Max"), all("SleepSession"), all("ExerciseSession"),
  ]);
  const at = (r: { startTime: string } | { time: string }) => new Date("time" in r ? r.time : r.startTime);
  const id = (r: { metadata?: { id?: string } }, fallback: string) => r.metadata?.id ?? fallback;
  const point = <R extends { time: string; metadata?: { id?: string } }>(rows: R[], metric: string, unit: string, value: (r: R) => number) =>
    rows.map((r) => ({ externalId: id(r, `${metric}:${r.time}`), at: r.time, metric, value: value(r), unit }));

  return {
    daily: [
      ...rollupDaily("steps", "count", steps.map((r) => ({ date: at(r), value: r.count })), "sum"),
      ...rollupDaily("distance", "m", distance.map((r) => ({ date: at(r), value: r.distance.inMeters })), "sum"),
      ...rollupDaily("floors", "count", floors.map((r) => ({ date: at(r), value: r.floors })), "sum"),
      ...rollupDaily("active_energy", "kcal", active.map((r) => ({ date: at(r), value: r.energy.inKilocalories })), "sum"),
      ...rollupDaily("total_energy", "kcal", total.map((r) => ({ date: at(r), value: r.energy.inKilocalories })), "sum"),
      ...rollupDaily("resting_hr", "bpm", restingHr.map((r) => ({ date: at(r), value: r.beatsPerMinute })), "avg"),
      ...rollupDaily("hrv_rmssd_night", "ms", hrv.map((r) => ({ date: at(r), value: r.heartRateVariabilityMillis })), "avg"),
      ...rollupDaily("spo2_avg", "pct", spo2.map((r) => ({ date: at(r), value: r.percentage })), "avg"),
      ...rollupDaily("respiration_avg", "brpm", resp.map((r) => ({ date: at(r), value: r.rate })), "avg"),
    ],
    points: [
      ...point(weight, "weight", "kg", (r) => r.weight.inKilograms),
      ...point(bodyFat, "body_fat_pct", "pct", (r) => r.percentage),
      ...point(leanMass, "lean_mass", "kg", (r) => r.mass.inKilograms),
      ...point(vo2, "vo2max", "ml_kg_min", (r) => r.vo2MillilitersPerMinuteKilogram),
    ],
    intraday: toSeries("heart_rate", "bpm", hr.flatMap((r) => r.samples.map((s) => ({ date: new Date(s.time), value: s.beatsPerMinute }))), 60),
    sleep: sleep.map((r) => ({
      externalId: id(r, r.startTime),
      start: r.startTime,
      end: r.endTime,
      stages: (r.stages ?? []).flatMap((s) => (STAGE[s.stage] ? [{ stage: STAGE[s.stage]!, start: s.startTime, end: s.endTime }] : [])),
    })),
    workouts: exercise.map((r) => ({ externalId: id(r, r.startTime), type: EXERCISE[r.exerciseType] ?? "other_workout", start: r.startTime, end: r.endTime })),
  };
}
