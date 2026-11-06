import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwner } from "../server/lib/ingest/owner";
import { saveTrainingPlan } from "../server/lib/training";
import { trainingPlanSchema } from "../shared/training";

export default defineAction({
  description: `Save the signed-in user's whole weekly training plan (replaces the previous one). Design it from their goals, experience, schedule, injuries and recovery (get-coach-profile, memory, get-health). Find exercise ids with search-exercises. Each weekday at most once; a day with no exercises is a rest/cardio day. Keep 4–8 exercises per session with sets, reps, optional RIR and one short cue. Show it with show-widget {kind:"training"} afterwards.`,
  schema: z.object({ plan: trainingPlanSchema }),
  run: async ({ plan }, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    try {
      return { plan: await saveTrainingPlan(userEmail, plan), message: "Training plan saved." };
    } catch (error) {
      fail((error as Error).message, { statusCode: 400, errorCode: "invalid_plan" });
    }
  },
});
