/**
 * Manual entry — the fallback source when no tracker is connected. Goes through the same ingestBatch path as
 * devices (validation, units, dedupe, encryption, audit), as provider/via "manual" under a fixed source per user.
 */
import { randomUUID } from "node:crypto";

import { recordChange } from "@agent-native/core/server";
import { getMetric, ingestBatchSchema } from "@vitls/health-ingest";

import type { OwnerScope } from "./devices";
import { ingestBatch } from "./ingest";

export interface ManualEntry {
  metric: string;
  value: number;
  unit?: string;
  /** Daily metrics: YYYY-MM-DD. Point metrics: ISO timestamp or YYYY-MM-DD (noon UTC). */
  when: string;
}

export interface ManualWorkout {
  type: string;
  start: string;
  durationMin: number;
  distanceKm?: number;
  energyKcal?: number;
}

/** A value the user can't enter by hand (intake, intraday or unknown metric). Routes map this to a 400; other errors stay server faults. */
export class ManualEntryError extends Error {}

const MANUAL_SOURCE_DEVICE = "manual";
const ENTITLEMENTS = { intraday: false, rawRetentionDays: 30 };

export async function logManual(owner: OwnerScope, input: { entries?: ManualEntry[]; workouts?: ManualWorkout[] }) {
  const daily = [];
  const points = [];
  for (const e of input.entries ?? []) {
    // Food intake has its own source (vitls/food); a manual intake_* value would outrank and hide the meals.
    if (e.metric.startsWith("intake_")) throw new ManualEntryError(`"${e.metric}" is logged through the food log (log-meal), not as a manual value`);
    const def = getMetric(e.metric);
    if (!def || def.kind === "intraday") throw new ManualEntryError(`"${e.metric}" can't be entered manually`);
    const unit = e.unit ?? def.unit;
    if (def.kind === "daily") {
      daily.push({ externalId: `manual:${e.metric}:${e.when.slice(0, 10)}`, date: e.when.slice(0, 10), metric: e.metric, value: e.value, unit });
    } else {
      const at = /^\d{4}-\d{2}-\d{2}$/.test(e.when) ? `${e.when}T12:00:00Z` : e.when;
      points.push({ externalId: `manual:${e.metric}:${at}`, at, metric: e.metric, value: e.value, unit });
    }
  }
  const workouts = (input.workouts ?? []).map((w) => ({
    externalId: `manual:workout:${w.start}`,
    type: w.type,
    start: w.start,
    end: new Date(Date.parse(w.start) + w.durationMin * 60_000).toISOString(),
    ...(w.distanceKm !== undefined ? { distanceM: w.distanceKm * 1000 } : {}),
    ...(w.energyKcal !== undefined ? { energyKcal: w.energyKcal } : {}),
  }));

  const batch = ingestBatchSchema.parse({
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    source: { provider: "manual", via: "manual", app: "VITLS" },
    daily,
    points,
    workouts,
  });
  const result = await ingestBatch({
    identity: { ...owner, deviceId: MANUAL_SOURCE_DEVICE, scope: "ingest:write" },
    batch,
    entitlements: ENTITLEMENTS,
    manual: true,
  });
  recordChange({ source: "health", type: "manual", key: result.sourceId, owner: owner.userEmail, orgId: owner.orgId ?? undefined });
  return result;
}
