/** Training plan in the native user setting `vitls-training`, enriched with exercise details for display. */
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import { WEEKDAYS, trainingPlanSchema, type TrainingPlan } from "../../shared/training";
import { getExercise } from "./exercises";

const SETTING_KEY = "vitls-training";

export async function getTrainingPlan(userEmail: string): Promise<TrainingPlan | null> {
  const stored = await getUserSetting(userEmail, SETTING_KEY);
  return stored?.plan ? trainingPlanSchema.parse(stored.plan) : null;
}

export async function saveTrainingPlan(userEmail: string, plan: TrainingPlan) {
  const unknown = plan.days.flatMap((d) => d.exercises).filter((e) => !getExercise(e.exerciseId));
  if (unknown.length) throw new Error(`Unknown exercise ids: ${unknown.map((e) => e.exerciseId).join(", ")} — use search-exercises`);
  await putUserSetting(userEmail, SETTING_KEY, { plan, updatedAt: new Date().toISOString() });
  return plan;
}

/** The plan's session for a weekday (default today in the given timezone), with exercise names and steps. */
export function sessionFor(plan: TrainingPlan, date = new Date(), timeZone = "UTC") {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date).toLowerCase().slice(0, 3);
  const day = plan.days.find((d) => d.weekday === weekday);
  return {
    weekday: WEEKDAYS.find((w) => w === weekday)!,
    title: day?.title ?? "Rest / free day",
    exercises: (day?.exercises ?? []).map((e) => {
      const ex = getExercise(e.exerciseId);
      return { ...e, name: ex?.name ?? e.exerciseId, target: ex?.target, equipment: ex?.equipment, steps: ex?.steps ?? [] };
    }),
  };
}
