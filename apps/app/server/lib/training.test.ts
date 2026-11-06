import { beforeAll, describe, expect, it } from "vitest";

import { trainingPlanSchema } from "../../shared/training";
import { setupTestDb } from "../test/db";
import { getExercise, searchExercises } from "./exercises";
import { getTrainingPlan, saveTrainingPlan, sessionFor } from "./training";

describe("exercise index", () => {
  it("contains the dataset without media fields", () => {
    const e = getExercise("0001")!;
    expect(e.name).toBeTruthy();
    expect(e.steps.length).toBeGreaterThan(0);
    expect(Object.keys(e)).not.toContain("gif_url");
  });

  it("searches by words and filters", () => {
    const results = searchExercises({ query: "lateral raise", equipment: "dumbbell" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.equipment === "dumbbell")).toBe(true);
    expect(results.some((r) => r.name.includes("lateral raise"))).toBe(true);
    expect(results[0]).not.toHaveProperty("steps");
  });
});

describe("training plan", () => {
  beforeAll(setupTestDb);
  const user = "lea@example.com";
  const plan = trainingPlanSchema.parse({
    name: "Upper/Lower",
    days: [
      { weekday: "wed", title: "Upper", exercises: [{ exerciseId: "0001", sets: 3, reps: "8-12", note: "slow eccentric" }] },
      { weekday: "thu", title: "Rest", exercises: [] },
    ],
  });

  it("saves, reads and resolves today's session with exercise details", async () => {
    expect(await getTrainingPlan(user)).toBeNull();
    await saveTrainingPlan(user, plan);
    expect(await getTrainingPlan(user)).toEqual(plan);
    // 2026-09-30 is a Wednesday.
    const session = sessionFor(plan, new Date("2026-09-30T08:00:00Z"), "Europe/Bratislava");
    expect(session).toMatchObject({ weekday: "wed", title: "Upper" });
    expect(session.exercises[0]).toMatchObject({ exerciseId: "0001", sets: 3, name: getExercise("0001")!.name });
    expect(sessionFor(plan, new Date("2026-10-03T08:00:00Z")).title).toBe("Rest / free day");
  });

  it("rejects unknown exercise ids", async () => {
    const bad = trainingPlanSchema.parse({ name: "x", days: [{ weekday: "mon", title: "x", exercises: [{ exerciseId: "9999", sets: 1, reps: "1" }] }] });
    await expect(saveTrainingPlan(user, bad)).rejects.toThrow(/9999/);
  });
});
