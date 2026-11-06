/** Apple Health reader: permissions + one sync window → VITLS ingest items. */
import {
  CategoryValueSleepAnalysis,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  WorkoutActivityType,
  type QuantityTypeIdentifier,
} from "@kingstinct/react-native-healthkit";

import { rollupDaily, sessionsFromStages, type HealthData, type Stage } from "./batch";

export const provider = "apple_health" as const;

const DAILY: { id: QuantityTypeIdentifier; metric: string; unit: string; agg: "sum" | "avg" }[] = [
  { id: "HKQuantityTypeIdentifierStepCount", metric: "steps", unit: "count", agg: "sum" },
  { id: "HKQuantityTypeIdentifierDistanceWalkingRunning", metric: "distance", unit: "m", agg: "sum" },
  { id: "HKQuantityTypeIdentifierActiveEnergyBurned", metric: "active_energy", unit: "kcal", agg: "sum" },
  { id: "HKQuantityTypeIdentifierRestingHeartRate", metric: "resting_hr", unit: "count/min", agg: "avg" },
  { id: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", metric: "hrv_sdnn_night", unit: "ms", agg: "avg" },
];
const STAGE: Partial<Record<number, Stage["stage"]>> = {
  [CategoryValueSleepAnalysis.asleepUnspecified]: "unknown",
  [CategoryValueSleepAnalysis.awake]: "awake",
  [CategoryValueSleepAnalysis.asleepCore]: "light",
  [CategoryValueSleepAnalysis.asleepDeep]: "deep",
  [CategoryValueSleepAnalysis.asleepREM]: "rem",
};

export async function requestAccess(): Promise<boolean> {
  if (!isHealthDataAvailable()) return false;
  return requestAuthorization({
    toRead: [...DAILY.map((d) => d.id), "HKQuantityTypeIdentifierBodyMass", "HKCategoryTypeIdentifierSleepAnalysis", "HKWorkoutTypeIdentifier"],
  });
}

export async function read(startDate: Date, endDate: Date): Promise<HealthData> {
  const filter = { date: { startDate, endDate } };
  const anchor = new Date(startDate);
  anchor.setHours(0, 0, 0, 0);

  const daily = (
    await Promise.all(
      DAILY.map(async ({ id, metric, unit, agg }) => {
        const stats = await queryStatisticsCollectionForQuantity(id, [agg === "sum" ? "cumulativeSum" : "discreteAverage"], anchor, { day: 1 }, { unit, filter });
        const samples = stats.flatMap((s) => {
          const q = agg === "sum" ? s.sumQuantity : s.averageQuantity;
          return s.startDate && q ? [{ date: s.startDate, value: q.quantity }] : [];
        });
        return rollupDaily(metric, unit, samples, agg);
      }),
    )
  ).flat();

  const weights = await queryQuantitySamples("HKQuantityTypeIdentifierBodyMass", { unit: "kg", filter, limit: 0 });
  const points = weights.map((w) => ({ externalId: w.uuid, at: w.startDate.toISOString(), metric: "weight", value: w.quantity, unit: "kg" }));

  const sleepSamples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", { filter, limit: 0, ascending: true });
  const sleep = sessionsFromStages(
    sleepSamples.flatMap((s) => {
      const stage = STAGE[s.value];
      return stage ? [{ id: s.uuid, stage, start: s.startDate.toISOString(), end: s.endDate.toISOString() }] : [];
    }),
  );

  const workouts = (await queryWorkoutSamples({ filter, limit: 0 })).map((w) => ({
    externalId: w.uuid,
    type: WorkoutActivityType[w.workoutActivityType] ?? "other",
    start: w.startDate.toISOString(),
    end: w.endDate.toISOString(),
    distanceM: w.totalDistance?.unit === "m" ? w.totalDistance.quantity : undefined,
    energyKcal: w.totalEnergyBurned?.unit === "kcal" ? w.totalEnergyBurned.quantity : undefined,
  }));

  return { daily, points, sleep, workouts };
}
