/**
 * Manual entry — the fallback source when no tracker is connected. Ported from apps/app/server/lib/ingest/manual.ts:
 * builds a provider/via "manual" batch for the shared IngestService.ingestBatch path. recordChange is dropped.
 */
import { randomUUID } from "node:crypto";

import { BadRequestException } from "@nestjs/common";

import type { Entitlements, IngestService } from "../ingest/ingest.service";

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

const ENTITLEMENTS: Entitlements = { intraday: false, rawRetentionDays: 30 };

export async function logManual(ingest: IngestService, ownerEmail: string, input: { entries?: ManualEntry[]; workouts?: ManualWorkout[] }) {
  const { getMetric, ingestBatchSchema } = await import("@vitls/health-ingest");
  const daily = [];
  const points = [];
  for (const e of input.entries ?? []) {
    // Food intake has its own source (vitls/food); a manual intake_* value would outrank and hide the meals.
    if (e.metric.startsWith("intake_")) throw new BadRequestException(`"${e.metric}" is logged through the food log (log-meal), not as a manual value`);
    const def = getMetric(e.metric);
    if (!def || def.kind === "intraday") throw new BadRequestException(`"${e.metric}" can't be entered manually`);
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

  const parsed = ingestBatchSchema.safeParse({
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    source: { provider: "manual", via: "manual", app: "VITLS" },
    daily,
    points,
    workouts,
  });
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300));
  return ingest.ingestBatch({
    identity: { userEmail: ownerEmail, deviceId: "manual", scope: "ingest:write" },
    batch: parsed.data,
    entitlements: ENTITLEMENTS,
    manual: true,
  });
}
