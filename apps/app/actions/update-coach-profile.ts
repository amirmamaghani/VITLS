import { defineAction } from "@agent-native/core/action";

import { coachProfileSchema } from "../shared/coach";
import { updateCoachProfile } from "../server/lib/coach/profile";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Update the signed-in user's coach profile with a partial patch (only the fields given change). Setting readoutTime (local HH:MM) schedules the daily morning readout in the profile timezone; null turns it off. Use onboardingStage to record intake progress and \"done\" when onboarding is complete.",
  schema: coachProfileSchema,
  run: async (patch, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    return { profile: await updateCoachProfile(userEmail, patch), message: "Coach profile updated." };
  },
});
