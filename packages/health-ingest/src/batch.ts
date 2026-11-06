import { z } from "zod";

import { getMetric, type MetricKind } from "./catalog";
import { normalizeValue } from "./units";

export const INGEST_LIMITS = {
  /** Total items across all sections of one batch; clients chunk larger syncs. */
  maxItems: 5000,
  /** Values in a single intraday series chunk (e.g. one day at 30 s resolution). */
  maxSeriesValues: 2880,
  /** Max request body accepted by the ingest endpoint. */
  maxBodyBytes: 2 * 1024 * 1024,
  /** Accepted measurement window: nothing before 2000 or more than 2 days in the future. */
  earliest: Date.parse("2000-01-01T00:00:00Z"),
  futureSkewMs: 2 * 86_400_000,
  maxSleepMs: 48 * 3_600_000,
  maxWorkoutMs: 7 * 86_400_000,
  maxScores: 16,
} as const;

export const PROVIDERS = ["garmin", "apple_health", "health_connect", "samsung_health", "oura", "whoop", "polar", "strava", "fitbit", "manual"] as const;
/** "manual" = typed by the user or logged by the coach from chat (session-authenticated, never via device tokens). */
export const VIAS = ["companion", "gccli-dev", "manual"] as const;
export const SLEEP_STAGES = ["awake", "light", "deep", "rem", "unknown"] as const;

const inWindow = (ms: number) => ms >= INGEST_LIMITS.earliest && ms <= Date.now() + INGEST_LIMITS.futureSkewMs;
const instant = z.iso.datetime({ offset: true }).refine((s) => inWindow(Date.parse(s)), "Timestamp outside the accepted window");
const day = z.iso.date().refine((s) => inWindow(Date.parse(`${s}T00:00:00Z`)), "Date outside the accepted window");
/**
 * Device-supplied text later reaches the coach LLM, so it is normalized rather than trusted:
 * identifiers become lowercase snake_case tokens (HealthKit camelCase and Health Connect UPPER_CASE included),
 * labels keep letters/marks/digits/common punctuation and drop everything else (control chars, markup, emoji).
 */
export function toIdentifier(value: string, max = 64): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
}

export function toLabel(value: string, max = 100): string {
  return value
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\p{Zs}'\u2019.,_()+/&#:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const identifier = (max: number) =>
  z.string().transform((v) => toIdentifier(v, max)).pipe(z.string().regex(/^[a-z0-9][a-z0-9_]*$/, "Expected an identifier"));
const label = (max: number) => z.string().transform((v) => toLabel(v, max)).pipe(z.string().min(1, "Label is empty after normalization"));
const zoneOffset = z.string().regex(/^[+-]\d{2}:\d{2}$/, "Expected ±HH:MM");
const externalId = z.string().min(1).max(200);
const finite = z.number().finite();

/** Validates that `metric` exists, is of the expected kind, and that `unit` converts to its canonical unit. */
function metricOfKind(kind: MetricKind) {
  return (item: { metric: string; unit: string; value?: number; values?: (number | null)[] }, ctx: z.RefinementCtx) => {
    const def = getMetric(item.metric);
    if (!def) {
      ctx.addIssue({ code: "custom", path: ["metric"], message: `Unknown metric "${item.metric}"` });
      return;
    }
    if (def.kind !== kind) {
      ctx.addIssue({ code: "custom", path: ["metric"], message: `Metric "${item.metric}" is ${def.kind}, not ${kind}` });
      return;
    }
    try {
      // Convert the real magnitude so overflow (e.g. 1e308 mi → Infinity m) is rejected here, not at write time.
      const magnitude = item.value ?? Math.max(1, ...(item.values ?? []).map((v) => Math.abs(v ?? 0)));
      normalizeValue(item.metric, magnitude, item.unit);
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: (error as Error).message });
    }
  };
}

function spanWithin(maxMs: number) {
  return (item: { start: string; end: string }, ctx: z.RefinementCtx) => {
    const span = Date.parse(item.end) - Date.parse(item.start);
    if (span < 0) ctx.addIssue({ code: "custom", path: ["end"], message: "end must not be before start" });
    else if (span > maxMs) ctx.addIssue({ code: "custom", path: ["end"], message: "session is implausibly long" });
  };
}

export const dailyItemSchema = z
  .object({ externalId, date: day, metric: z.string(), value: finite, unit: z.string() })
  .superRefine(metricOfKind("daily"));

export const pointItemSchema = z
  .object({ externalId, at: instant, zoneOffset: zoneOffset.optional(), metric: z.string(), value: finite, unit: z.string() })
  .superRefine(metricOfKind("point"));

export const intradaySeriesSchema = z
  .object({
    metric: z.string(),
    unit: z.string(),
    start: instant,
    intervalSec: z.number().int().positive().max(3600),
    values: z.array(finite.nullable()).min(1).max(INGEST_LIMITS.maxSeriesValues),
  })
  .superRefine(metricOfKind("intraday"));

export const sleepSessionSchema = z
  .object({
    externalId,
    start: instant,
    end: instant,
    stages: z.array(z.object({ stage: z.enum(SLEEP_STAGES), start: instant, end: instant })).max(500).default([]),
    scores: z
      .record(identifier(32), finite)
      .refine((o) => Object.keys(o).length <= INGEST_LIMITS.maxScores, `At most ${INGEST_LIMITS.maxScores} scores`)
      .optional(),
  })
  .superRefine(spanWithin(INGEST_LIMITS.maxSleepMs));

export const workoutSchema = z
  .object({
    externalId,
    type: identifier(64),
    start: instant,
    end: instant,
    distanceM: finite.nonnegative().optional(),
    energyKcal: finite.nonnegative().optional(),
    avgHr: finite.positive().optional(),
    maxHr: finite.positive().optional(),
    poolLengthM: finite.min(10).max(100).optional(),
    strokes: z.number().int().nonnegative().optional(),
    zones: z.array(z.object({ zone: z.number().int().min(0).max(10), seconds: finite.nonnegative() })).max(10).optional(),
    sets: z
      .array(z.object({ exercise: identifier(64), reps: z.number().int().nonnegative().optional(), weightKg: finite.nonnegative().optional(), durationS: finite.nonnegative().optional() }))
      .max(200)
      .optional(),
  })
  .superRefine(spanWithin(INGEST_LIMITS.maxWorkoutMs));

export const ingestBatchSchema = z
  .object({
    batchId: z.uuid(),
    sentAt: instant,
    source: z.object({
      provider: z.enum(PROVIDERS),
      via: z.enum(VIAS),
      app: label(100).optional(),
      device: label(100).optional(),
      os: label(60).optional(),
    }),
    daily: z.array(dailyItemSchema).default([]),
    points: z.array(pointItemSchema).default([]),
    intraday: z.array(intradaySeriesSchema).default([]),
    sleep: z.array(sleepSessionSchema).default([]),
    workouts: z.array(workoutSchema).default([]),
    deleted: z.array(z.object({ kind: z.enum(["daily", "point", "sleep", "workout"]), externalId })).default([]),
  })
  .superRefine((batch, ctx) => {
    const total =
      batch.daily.length + batch.points.length + batch.intraday.length + batch.sleep.length + batch.workouts.length + batch.deleted.length;
    if (total > INGEST_LIMITS.maxItems) {
      ctx.addIssue({ code: "custom", message: `Batch has ${total} items; max is ${INGEST_LIMITS.maxItems}` });
    }
  });

export type IngestBatch = z.infer<typeof ingestBatchSchema>;

/** Plain-text device label (model name etc.) accepted at pairing time. */
export const deviceLabelSchema = label(100);
export type IngestBatchInput = z.input<typeof ingestBatchSchema>;

/** Returns a copy of a validated batch with every metric value converted to its canonical unit. */
export function normalizeBatch(batch: IngestBatch): IngestBatch {
  const canonical = (metric: string) => getMetric(metric)!.unit;
  return {
    ...batch,
    daily: batch.daily.map((d) => ({ ...d, value: normalizeValue(d.metric, d.value, d.unit), unit: canonical(d.metric) })),
    points: batch.points.map((p) => ({ ...p, value: normalizeValue(p.metric, p.value, p.unit), unit: canonical(p.metric) })),
    intraday: batch.intraday.map((s) => ({
      ...s,
      values: s.values.map((v) => (v === null ? null : normalizeValue(s.metric, v, s.unit))),
      unit: canonical(s.metric),
    })),
  };
}
