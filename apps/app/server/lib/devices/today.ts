/** Native "Today" screen of the companion: readout + three numbers + what the user's goals still lack. Read-only. */
import { and, desc, eq, ne } from "drizzle-orm";

import { GOAL_MODULES } from "../../../shared/coach";
import { getDb, schema } from "../../db";
import { getCoachProfile } from "../coach/profile";
import { getReadout } from "../coach/readout";
import { getHealth } from "../health/read";
import type { OwnerScope } from "../ingest/devices";

export interface TodayView {
  date: string;
  readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;
  metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
  lastBatchAt: string | null;
  missing: string[];
}

const LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

export async function getToday(owner: OwnerScope): Promise<TodayView> {
  const { profile } = await getCoachProfile(owner.userEmail);
  const tz = profile.timezone ?? "UTC";
  const date = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const from = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toLocaleDateString("en-CA", { timeZone: tz });
  const [readout, health, [source]] = await Promise.all([
    getReadout(owner.userEmail),
    getHealth(owner.userEmail, { from, to: date, include: ["daily", "points"] }),
    getDb()
      .select({ lastSyncAt: schema.healthSources.lastSyncAt })
      .from(schema.healthSources)
      // "Data from this phone": device batches only; a manual quick log or a revoked source must not look like a sync.
      .where(and(eq(schema.healthSources.ownerEmail, owner.userEmail), ne(schema.healthSources.via, "manual"), eq(schema.healthSources.status, "active")))
      .orderBy(desc(schema.healthSources.lastSyncAt))
      .limit(1),
  ]);

  const todayValue = (metric: string) => health.daily?.[metric]?.values.find((v) => v.date === date)?.value;
  const metrics: TodayView["metrics"] = {};
  const steps = todayValue("steps");
  const restingHr = todayValue("resting_hr");
  const sleepSeconds = todayValue("sleep_duration");
  if (steps !== undefined) metrics.steps = steps;
  if (restingHr !== undefined) metrics.resting_hr = restingHr;
  // Catalog unit is seconds; the Today screen shows minutes.
  if (sleepSeconds !== undefined) metrics.sleep_min = Math.round(sleepSeconds / 60);

  const seen = new Set([...Object.keys(health.daily ?? {}), ...Object.keys(health.points ?? {})]);
  const needed = [...new Set((profile.goals ?? []).flatMap((g) => GOAL_MODULES[g.module]?.metrics ?? []))];
  return {
    date,
    readout: readout ? { greeting: readout.greeting, directive: readout.directive, highlights: readout.highlights } : null,
    metrics,
    lastBatchAt: source?.lastSyncAt ?? null,
    missing: needed.filter((m) => !seen.has(m)),
  };
}
