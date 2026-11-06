import { getMetric, type CanonicalUnit } from "./catalog";

/** Accepted non-canonical units and their factor to the canonical unit. */
const CONVERSIONS: Partial<Record<CanonicalUnit, Record<string, number>>> = {
  kg: { g: 0.001, lb: 0.45359237 },
  kcal: { kJ: 1 / 4.184 },
  s: { ms: 0.001, min: 60, h: 3600 },
  m: { km: 1000, mi: 1609.344, cm: 0.01, in: 0.0254 },
  g: { mg: 0.001, ug: 0.000001, kg: 1000 },
  mg: { g: 1000, ug: 0.001 },
  ug: { mg: 1000, g: 1_000_000 },
  ml: { l: 1000, cl: 10, dl: 100 },
};

/** Converts a value to the metric's canonical unit; throws on unknown metric, unknown unit or non-finite value. */
export function normalizeValue(metricKey: string, value: number, unit: string): number {
  const metric = getMetric(metricKey);
  if (!metric) throw new Error(`Unknown metric "${metricKey}"`);
  if (!Number.isFinite(value)) throw new Error(`Value for "${metricKey}" must be finite`);
  if (unit === metric.unit) return value;
  const factor = CONVERSIONS[metric.unit]?.[unit];
  if (factor === undefined) {
    throw new Error(`Unit "${unit}" is not convertible to "${metric.unit}" for metric "${metricKey}"`);
  }
  const converted = value * factor;
  if (!Number.isFinite(converted)) throw new Error(`Value for "${metricKey}" must be finite after conversion`);
  return converted;
}
