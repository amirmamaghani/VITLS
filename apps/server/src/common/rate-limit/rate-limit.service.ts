import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { rateLimits as t } from "../../db/schema";
import type { RateLimitRule } from "./limits";

/** Atomic fixed-window limiter in Postgres: one upsert resets an expired window or increments, so concurrent requests cannot slip past. */
@Injectable()
export class RateLimitService {
  constructor(private readonly dbs: DbService) {}

  /** Adds `amount` to the window for `key`; returns false when the window total exceeds the limit. */
  async hitRateLimit(key: string, rule: RateLimitRule, amount = 1): Promise<boolean> {
    const now = Date.now();
    const expired = sql`${t.windowStart} <= ${now - rule.windowMs}`;
    const [row] = await this.dbs.db
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
}
