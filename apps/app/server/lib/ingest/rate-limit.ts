/**
 * Atomic fixed-window rate limiting in Postgres (no in-memory state: serverless-safe).
 * One upsert both resets an expired window and increments, so concurrent requests cannot slip past the check.
 */
import { lt, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

/** Adds `amount` to the window for `key`; returns false when the window total exceeds the limit. */
export async function hitRateLimit(key: string, rule: RateLimitRule, amount = 1): Promise<boolean> {
  const now = Date.now();
  const t = schema.rateLimits;
  const expired = sql`${t.windowStart} <= ${now - rule.windowMs}`;
  const [row] = await getDb()
    .insert(t)
    .values({ key, windowStart: now, count: amount })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN ${amount} ELSE ${t.count} + ${amount} END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.windowStart} END`,
      },
    })
    .returning({ count: t.count });
  return Number(row!.count) <= rule.limit;
}

/** Deletes counters whose window ended more than a day ago (run from the scheduled purge). */
export async function purgeStaleRateLimits(): Promise<number> {
  const removed = await getDb()
    .delete(schema.rateLimits)
    .where(lt(schema.rateLimits.windowStart, Date.now() - 2 * 86_400_000))
    .returning({ key: schema.rateLimits.key });
  return removed.length;
}

export const LIMITS = {
  /** Authenticated ingest requests per device, counted before the body is read. */
  ingestRequests: { windowMs: 60_000, limit: 60 },
  /** Ingest body bytes per device per day: steady state is well under 1 MB/day; headroom for a first backfill. */
  ingestBytes: { windowMs: 86_400_000, limit: 50 * 1024 * 1024 },
  /** Pairing redemptions per client address. */
  redeemPerClient: { windowMs: 60_000, limit: 10 },
  /**
   * Pairing redemptions across all clients. Codes carry ~60 bits, so this is only a resource backstop and is
   * set high enough that one attacker cannot lock everyone out of pairing.
   */
  redeemGlobal: { windowMs: 60_000, limit: 5000 },
  /** Outstanding (unused, unexpired) pairing codes per user. */
  openPairingsPerUser: 5,
} as const satisfies Record<string, RateLimitRule | number>;
