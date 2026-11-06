import { like } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { rateLimits } from "../../db/schema";
import { RateLimitService } from "./rate-limit.service";

describe("RateLimitService", () => {
  const dbs = new DbService();
  const svc = new RateLimitService(dbs);
  const p = `rl-test-${Date.now()}:`;
  afterAll(async () => {
    await dbs.db.delete(rateLimits).where(like(rateLimits.key, `${p}%`));
    await dbs.onModuleDestroy();
  });

  test("returns false once the window is exhausted", async () => {
    const rule = { windowMs: 60_000, limit: 2 };
    expect(await svc.hitRateLimit(`${p}exhaust`, rule)).toBe(true);
    expect(await svc.hitRateLimit(`${p}exhaust`, rule)).toBe(true);
    expect(await svc.hitRateLimit(`${p}exhaust`, rule)).toBe(false);
  });

  test("separate keys have separate counters", async () => {
    const rule = { windowMs: 60_000, limit: 1 };
    expect(await svc.hitRateLimit(`${p}a`, rule)).toBe(true);
    expect(await svc.hitRateLimit(`${p}b`, rule)).toBe(true);
  });

  test("an expired window resets the counter", async () => {
    const key = `${p}reset`;
    await dbs.db.insert(rateLimits).values({ key, windowStart: Date.now() - 120_000, count: 99 });
    expect(await svc.hitRateLimit(key, { windowMs: 60_000, limit: 1 })).toBe(true);
    expect(await svc.hitRateLimit(key, { windowMs: 60_000, limit: 1 })).toBe(false);
  });

  test("amount counts toward the window", async () => {
    expect(await svc.hitRateLimit(`${p}amt`, { windowMs: 60_000, limit: 10 }, 11)).toBe(false);
  });
});
