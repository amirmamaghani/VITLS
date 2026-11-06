import { ingestBatchSchema } from "@vitls/health-ingest";
import { describe, expect, it } from "vitest";

import { buildDayBatch, toRegularSeries, mapActivities, mapWeighIns } from "./map";

// Synthetic, anonymised fixtures shaped like gccli 1.9 JSON output.
const summary = {
  calendarDate: "2026-09-30",
  wellnessStartTimeGmt: "2026-09-29T22:00:00.0",
  wellnessStartTimeLocal: "2026-09-30T00:00:00.0",
  totalSteps: 9000,
  totalDistanceMeters: 7000,
  floorsAscended: 12.4,
  activeKilocalories: 600,
  totalKilocalories: 2500,
  moderateIntensityMinutes: 20,
  vigorousIntensityMinutes: 10,
  restingHeartRate: 52,
  averageStressLevel: 30,
  averageSpo2: 96,
  avgWakingRespirationValue: 14,
  bodyBatteryHighestValue: 90,
  bodyBatteryLowestValue: 15,
};

const sleep = {
  dailySleepDTO: {
    id: 1234,
    calendarDate: "2026-09-30",
    sleepTimeSeconds: 27000,
    sleepStartTimestampGMT: Date.parse("2026-09-29T21:00:00Z"),
    sleepEndTimestampGMT: Date.parse("2026-09-30T05:00:00Z"),
    sleepScores: { overall: { value: 82, qualifierKey: "GOOD" } },
  },
  sleepLevels: [
    { startGMT: "2026-09-29T21:00:00.0", endGMT: "2026-09-29T22:00:00.0", activityLevel: 1 },
    { startGMT: "2026-09-29T22:00:00.0", endGMT: "2026-09-29T23:00:00.0", activityLevel: 0 },
    { startGMT: "2026-09-29T23:00:00.0", endGMT: "2026-09-29T23:30:00.0", activityLevel: 2 },
  ],
};

const base = Date.parse("2026-09-29T22:00:00Z");
const hr = { heartRateValues: [[base, 55], [base + 120_000, 57], [base + 360_000, null], [base + 480_000, 60]] };
const stress = { stressValuesArray: [[base, 20], [base + 180_000, -1], [base + 360_000, 35]], bodyBatteryValuesArray: [[base, "MEASURED", 80, 1], [base + 180_000, "MEASURED", 79, 1]] };

describe("toRegularSeries", () => {
  it("places irregular samples on a regular grid and fills gaps with null", () => {
    expect(toRegularSeries(hr.heartRateValues as [number, number | null][], 120)).toEqual({ start: base, values: [55, 57, null, null, 60] });
  });

  it("treats negative Garmin sentinels as missing", () => {
    expect(toRegularSeries(stress.stressValuesArray as [number, number][], 180).values).toEqual([20, null, 35]);
  });
});

describe("buildDayBatch", () => {
  const batch = buildDayBatch({
    date: "2026-09-30",
    summary,
    sleep,
    hrv: { hrvSummary: { lastNightAvg: 48 } },
    readiness: [{ score: 71 }],
    hr,
    stress,
  });

  it("produces a batch the ingest contract accepts", () => {
    expect(() => ingestBatchSchema.parse(batch)).not.toThrow();
    expect(batch.source).toMatchObject({ provider: "garmin", via: "gccli-dev" });
  });

  it("maps the daily summary", () => {
    const byMetric = Object.fromEntries(batch.daily!.map((d) => [d.metric, d.value]));
    expect(byMetric).toMatchObject({
      steps: 9000,
      distance: 7000,
      floors: 12,
      active_energy: 600,
      total_energy: 2500,
      intensity_minutes: 40 * 60,
      resting_hr: 52,
      stress_avg: 30,
      hrv_rmssd_night: 48,
      sleep_duration: 27000,
      sleep_score: 82,
      training_readiness: 71,
      body_battery_high: 90,
      body_battery_low: 15,
    });
  });

  it("maps sleep stages", () => {
    expect(batch.sleep![0]).toMatchObject({ externalId: "garmin:sleep:1234", start: "2026-09-29T21:00:00.000Z", end: "2026-09-30T05:00:00.000Z" });
    expect(batch.sleep![0]!.stages!.map((s) => s.stage)).toEqual(["light", "deep", "rem"]);
  });

  it("emits intraday series with the device-local offset", () => {
    const heart = batch.intraday!.find((s) => s.metric === "heart_rate")!;
    expect(heart.start).toBe("2026-09-30T00:00:00+02:00");
    expect(heart.intervalSec).toBe(120);
  });

  it("omits missing values instead of sending zeros", () => {
    const empty = buildDayBatch({ date: "2026-09-30", summary: { calendarDate: "2026-09-30", restingHeartRate: null } });
    expect(empty.daily).toEqual([]);
  });
});

describe("mapWeighIns", () => {
  it("converts grams and keeps platform body-composition values", () => {
    const points = mapWeighIns({
      dailyWeightSummaries: [
        { allWeightMetrics: [{ samplePk: 9, timestampGMT: Date.parse("2026-09-30T05:10:00Z"), weight: 82400, bodyFat: 22.5, muscleMass: 35000, bodyWater: 55 }] },
      ],
    });
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalId: "garmin:weight:9:weight", metric: "weight", value: 82400, unit: "g" }),
        expect.objectContaining({ metric: "body_fat_pct", value: 22.5, unit: "pct" }),
        expect.objectContaining({ metric: "muscle_mass", value: 35000, unit: "g" }),
      ]),
    );
  });
});

describe("mapActivities", () => {
  it("maps workouts with zones and strength sets", () => {
    const [w] = mapActivities([
      {
        activityId: 77,
        activityType: { typeKey: "strength_training" },
        startTimeGMT: "2026-09-30 16:00:00",
        duration: 3600,
        distance: 0,
        calories: 400,
        averageHR: 110,
        maxHR: 150,
        hrTimeInZone_1: 600,
        hrTimeInZone_2: 1200,
        summarizedExerciseSets: [{ category: "SQUAT", reps: 15, sets: 3, maxWeight: 100000 }],
      },
    ]);
    expect(w).toMatchObject({
      externalId: "garmin:activity:77",
      type: "strength_training",
      start: "2026-09-30T16:00:00.000Z",
      end: "2026-09-30T17:00:00.000Z",
      energyKcal: 400,
      zones: [{ zone: 1, seconds: 600 }, { zone: 2, seconds: 1200 }],
      sets: [{ exercise: "squat", reps: 15, weightKg: 100 }],
    });
  });
});
