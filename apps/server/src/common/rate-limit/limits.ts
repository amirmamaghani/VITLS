export interface RateLimitRule {
  windowMs: number;
  limit: number;
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
