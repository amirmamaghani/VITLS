import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import * as schema from "../db/schema";
import { ExercisesService } from "./exercises.service";
import { WEEKDAYS } from "./training.schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

describe("ExercisesService", () => {
  const db = new DbService();
  const svc = new ExercisesService(new SettingsService(db));
  const owner = "exercises-spec@t.co";

  afterAll(async () => {
    await db.db.delete(schema.userSettings).where(eq(schema.userSettings.ownerEmail, owner));
  });

  it("search returns capped summaries without steps", () => {
    const { exercises } = svc.search({ query: "press", limit: 5 });
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.length).toBeLessThanOrEqual(5);
    for (const e of exercises) expect(e).not.toHaveProperty("steps");
  });

  it("rejects unknown exercise ids", async () => {
    const plan = { name: "Bad", days: [{ weekday: "mon" as const, title: "X", exercises: [{ exerciseId: "9999", sets: 3, reps: "8" }] }] };
    await expect(svc.saveTrainingPlan(owner, plan)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("round-trips the plan and resolves today's session", async () => {
    expect((await svc.getTrainingPlan(owner)).plan).toBeNull();
    const id = svc.search({ query: "press", limit: 1 }).exercises[0]!.id;
    const weekday = WEEKDAYS[(new Date().getUTCDay() + 6) % 7]!;
    const plan = { name: "P", days: [{ weekday, title: "Today", exercises: [{ exerciseId: id, sets: 3, reps: "8-12" }] }] };
    expect((await svc.saveTrainingPlan(owner, plan)).message).toBe("Training plan saved.");
    const got = await svc.getTrainingPlan(owner);
    expect(got.plan).toEqual(plan);
    expect(got.today!.weekday).toBe(weekday);
    expect(got.today!.title).toBe("Today");
    expect(got.today!.exercises[0]!.steps.length).toBeGreaterThan(0);
  });
});
