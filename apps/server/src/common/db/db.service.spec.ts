import { randomBytes } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { runWithOwner } from "../field-crypto-context";
import { rateLimits, workouts } from "../../db/schema";
import { DbService } from "./db.service";

process.env.VITLS_FIELD_KEYS = `k1:${randomBytes(32).toString("base64")}`;

describe("DbService", () => {
  const svc = new DbService();
  afterAll(async () => {
    await svc.db.delete(workouts).where(like(workouts.id, "w-%"));
    await svc.db.delete(rateLimits).where(eq(rateLimits.key, "t:1"));
    await svc.onModuleDestroy();
  });

  test("runs a query against Postgres", async () => {
    await svc.db.delete(rateLimits).where(eq(rateLimits.key, "t:1"));
    await svc.db.insert(rateLimits).values({ key: "t:1", windowStart: 1, count: 1 });
    const [row] = await svc.db.select().from(rateLimits).where(eq(rateLimits.key, "t:1"));
    expect(row?.key).toBe("t:1");
  });

  const workout = (id: string) => ({
    id, sourceId: "s", externalId: id, type: "strength", startAt: new Date(), endAt: new Date(),
    updatedAt: "2026-01-01", ownerEmail: "a@b.co",
    sets: [{ exercise: "squat", reps: 5 }] as never,
  });

  test("encrypted column round-trips through live Postgres", async () => {
    const id = `w-${Date.now()}`;
    await runWithOwner("a@b.co", async () => {
      await svc.db.insert(workouts).values(workout(id));
      const [row] = await svc.db.select().from(workouts).where(eq(workouts.id, id));
      expect(row?.sets).toEqual([{ exercise: "squat", reps: 5 }]);
      const [raw] = await svc.db.execute<{ sets: string }>(sql`select sets from workouts where id = ${id}`);
      expect(raw?.sets).toMatch(/^enc:v1:/);
      expect(raw?.sets).not.toMatch(/squat/);
    });
  });

  test("encrypted write outside runWithOwner fails closed", async () => {
    const id = `w-x-${Date.now()}`;
    await expect(svc.db.insert(workouts).values(workout(id))).rejects.toThrow(/owner context/);
    expect(await svc.db.select().from(workouts).where(eq(workouts.id, id))).toHaveLength(0);
  });
});
