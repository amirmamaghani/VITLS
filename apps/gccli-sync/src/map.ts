/**
 * Pure mappers from gccli JSON (Garmin Connect shapes, gccli 1.9) to the VITLS ingest contract.
 * Units are passed through as Garmin reports them; the server normalizes to canonical units.
 */
import { randomUUID } from "node:crypto";

import type { IngestBatchInput } from "@vitls/health-ingest";

type Json = Record<string, any>;
type Daily = NonNullable<IngestBatchInput["daily"]>[number];
type Point = NonNullable<IngestBatchInput["points"]>[number];
type Series = NonNullable<IngestBatchInput["intraday"]>[number];
type Sleep = NonNullable<IngestBatchInput["sleep"]>[number];
type Workout = NonNullable<IngestBatchInput["workouts"]>[number];

const SOURCE = { provider: "garmin", via: "gccli-dev", app: "gccli" } as const;

// Garmin sleepLevels.activityLevel codes (python-garminconnect convention).
const SLEEP_LEVEL: Record<number, "deep" | "light" | "rem" | "awake"> = { 0: "deep", 1: "light", 2: "rem", 3: "awake" };

/** Ingest only accepts snake_case identifiers for device-supplied names (they later reach the coach LLM). */
const identifier = (v: unknown, fallback: string) =>
  String(v ?? fallback).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || fallback;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Garmin timestamps without a zone ("2026-09-30T05:00:00.0" or "2026-09-30 05:00:00") are UTC. */
const utc = (s: string) => new Date(`${s.replace(" ", "T").replace(/\.\d+$/, "")}Z`).toISOString();

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** ISO timestamp in the device's local offset, so the server can derive the local calendar day. */
function localIso(ms: number, offsetMin: number): string {
  return `${new Date(ms + offsetMin * 60_000).toISOString().slice(0, 19)}${formatOffset(offsetMin)}`;
}

/** UTC offset in minutes from the daily summary's paired local/GMT timestamps. */
function offsetMinutes(summary: Json | undefined): number {
  if (!summary?.wellnessStartTimeLocal || !summary?.wellnessStartTimeGmt) return 0;
  return Math.round((Date.parse(utc(summary.wellnessStartTimeLocal)) - Date.parse(utc(summary.wellnessStartTimeGmt))) / 60_000);
}

/** Places irregular [timestamp, value] samples on a fixed grid; gaps and negative sentinels become null. */
export function toRegularSeries(samples: [number, number | null][], intervalSec: number) {
  const valid = samples.filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]);
  if (valid.length === 0) return { start: 0, values: [] as (number | null)[] };
  const start = valid[0]![0];
  const step = intervalSec * 1000;
  const values: (number | null)[] = new Array(Math.round((valid.at(-1)![0] - start) / step) + 1).fill(null);
  for (const [t, v] of valid) values[Math.round((t - start) / step)] = typeof v === "number" && v >= 0 ? v : null;
  return { start, values };
}

function medianIntervalSec(samples: [number, unknown][]): number {
  const diffs = samples.slice(1).map(([t], i) => t - samples[i]![0]).filter((d) => d > 0).sort((a, b) => a - b);
  return diffs.length ? Math.max(1, Math.round(diffs[Math.floor(diffs.length / 2)]! / 1000)) : 60;
}

/** `valueIndex` is the position of the value in each Garmin row (see the response's *Descriptors list). */
function series(metric: string, unit: string, raw: unknown, valueIndex: number, offsetMin: number): Series | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const samples = raw.map((r: unknown[]) => [Number(r[0]), num(r[valueIndex]) ?? null] as [number, number | null]);
  const intervalSec = medianIntervalSec(samples);
  const { start, values } = toRegularSeries(samples, intervalSec);
  if (values.length === 0) return undefined;
  return { metric, unit, start: localIso(start, offsetMin), intervalSec, values: values.slice(0, 2880) };
}

export interface DayInput {
  date: string;
  summary?: Json;
  sleep?: Json;
  hrv?: Json;
  readiness?: Json[];
  hr?: Json;
  stress?: Json;
}

/** Builds one ingest batch for a calendar day. */
export function buildDayBatch(day: DayInput): IngestBatchInput {
  const { date, summary: s = {}, sleep, hrv, readiness, hr, stress } = day;
  const daily: Daily[] = [];
  const add = (metric: string, value: number | undefined, unit: string) => {
    if (value === undefined || value < 0) return;
    daily.push({ externalId: `garmin:daily:${date}:${metric}`, date, metric, value, unit });
  };

  add("steps", num(s.totalSteps), "count");
  add("distance", num(s.totalDistanceMeters), "m");
  add("floors", num(s.floorsAscended) === undefined ? undefined : Math.round(s.floorsAscended), "count");
  add("active_energy", num(s.activeKilocalories), "kcal");
  add("total_energy", num(s.totalKilocalories), "kcal");
  const moderate = num(s.moderateIntensityMinutes);
  const vigorous = num(s.vigorousIntensityMinutes);
  // Garmin counts vigorous minutes double toward intensity minutes.
  add("intensity_minutes", moderate === undefined && vigorous === undefined ? undefined : ((moderate ?? 0) + 2 * (vigorous ?? 0)) * 60, "s");
  add("resting_hr", num(s.restingHeartRate), "bpm");
  add("stress_avg", num(s.averageStressLevel), "score");
  add("spo2_avg", num(s.averageSpo2), "pct");
  add("respiration_avg", num(s.avgWakingRespirationValue), "brpm");
  add("body_battery_high", num(s.bodyBatteryHighestValue), "score");
  add("body_battery_low", num(s.bodyBatteryLowestValue), "score");
  add("hrv_rmssd_night", num(hrv?.hrvSummary?.lastNightAvg), "ms");
  add("training_readiness", num(readiness?.[0]?.score), "score");

  const sleepDto = sleep?.dailySleepDTO;
  const sleepSessions: Sleep[] = [];
  if (sleepDto && num(sleepDto.sleepStartTimestampGMT) && num(sleepDto.sleepEndTimestampGMT)) {
    add("sleep_duration", num(sleepDto.sleepTimeSeconds), "s");
    add("sleep_score", num(sleepDto.sleepScores?.overall?.value), "score");
    sleepSessions.push({
      externalId: `garmin:sleep:${sleepDto.id ?? date}`,
      start: new Date(sleepDto.sleepStartTimestampGMT).toISOString(),
      end: new Date(sleepDto.sleepEndTimestampGMT).toISOString(),
      stages: (sleep.sleepLevels ?? [])
        .filter((l: Json) => typeof l.startGMT === "string" && typeof l.endGMT === "string")
        .map((l: Json) => ({ stage: SLEEP_LEVEL[Math.round(l.activityLevel)] ?? "unknown", start: utc(l.startGMT), end: utc(l.endGMT) })),
      ...(num(sleepDto.sleepScores?.overall?.value) !== undefined ? { scores: { overall: sleepDto.sleepScores.overall.value } } : {}),
    });
  }

  const offset = offsetMinutes(s);
  const intraday = [
    series("heart_rate", "bpm", hr?.heartRateValues, 1, offset),
    series("stress", "score", stress?.stressValuesArray, 1, offset),
    // [timestamp, status, level, version]
    series("body_battery", "score", stress?.bodyBatteryValuesArray, 2, offset),
  ].filter((x): x is Series => x !== undefined);

  return { batchId: randomUUID(), sentAt: new Date().toISOString(), source: SOURCE, daily, sleep: sleepSessions, intraday };
}

/** Weigh-ins (Garmin reports mass in grams). Body composition is taken as reported (decision D8). */
export function mapWeighIns(weighIns: Json | undefined): Point[] {
  const points: Point[] = [];
  for (const day of weighIns?.dailyWeightSummaries ?? []) {
    for (const m of day.allWeightMetrics ?? []) {
      if (!num(m.timestampGMT)) continue;
      const at = new Date(m.timestampGMT).toISOString();
      const push = (metric: string, value: number | undefined, unit: string) => {
        if (value !== undefined && value > 0) points.push({ externalId: `garmin:weight:${m.samplePk}:${metric}`, at, metric, value, unit });
      };
      push("weight", num(m.weight), "g");
      push("body_fat_pct", num(m.bodyFat), "pct");
      push("muscle_mass", num(m.muscleMass), "g");
      push("body_water_pct", num(m.bodyWater), "pct");
    }
  }
  return points;
}

export function mapActivities(activities: Json[] | undefined): Workout[] {
  return (activities ?? [])
    .filter((a) => a.activityId && typeof a.startTimeGMT === "string" && num(a.duration) !== undefined)
    .map((a) => {
      const start = utc(a.startTimeGMT);
      const zones = [1, 2, 3, 4, 5]
        .map((zone) => ({ zone, seconds: num(a[`hrTimeInZone_${zone}`]) }))
        .filter((z): z is { zone: number; seconds: number } => z.seconds !== undefined);
      const sets = (a.summarizedExerciseSets ?? []).map((set: Json) => ({
        exercise: identifier(set.subCategory ?? set.category, "unknown"),
        ...(num(set.reps) !== undefined ? { reps: set.reps } : {}),
        // Garmin exercise-set weights are reported in grams.
        ...(num(set.maxWeight) ? { weightKg: set.maxWeight / 1000 } : {}),
      }));
      return {
        externalId: `garmin:activity:${a.activityId}`,
        type: identifier(a.activityType?.typeKey, "other"),
        start,
        end: new Date(Date.parse(start) + a.duration * 1000).toISOString(),
        ...(num(a.distance) !== undefined ? { distanceM: a.distance } : {}),
        ...(num(a.calories) !== undefined ? { energyKcal: a.calories } : {}),
        ...(num(a.averageHR) ? { avgHr: a.averageHR } : {}),
        ...(num(a.maxHR) ? { maxHr: a.maxHR } : {}),
        ...(zones.length ? { zones } : {}),
        ...(sets.length ? { sets } : {}),
      };
    });
}
