/** Pure training-plan helpers: enrich a plan's weekday session with exercise details. */
import { getExercise } from "./exercises";
import { WEEKDAYS, type TrainingPlan } from "./training.schema";

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
