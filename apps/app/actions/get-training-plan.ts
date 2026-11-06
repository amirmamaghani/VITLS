import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCoachProfile } from "../server/lib/coach/profile";
import { requireOwner } from "../server/lib/ingest/owner";
import { getTrainingPlan, sessionFor } from "../server/lib/training";

export default defineAction({
  description:
    "Read the signed-in user's training plan (weekly days with exercises, sets, reps, RIR, cues) and today's session in their timezone, with exercise names and step-by-step instructions. plan is null until the coach saves one.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    const plan = await getTrainingPlan(userEmail);
    const { profile } = await getCoachProfile(userEmail);
    return { plan, today: plan ? sessionFor(plan, new Date(), profile.timezone ?? "UTC") : null };
  },
});
