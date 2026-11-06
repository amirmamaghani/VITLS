import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { GOAL_MODULES, PERSONAS } from "../shared/coach";
import { getCoachProfile } from "../server/lib/coach/profile";
import { getReadout } from "../server/lib/coach/readout";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Read the signed-in user's coach profile (persona, strictness, language, timezone, units, readout time, onboarding stage, goals), the latest saved morning readout (or null), plus whether onboarding is done and the morning readout is scheduled. Also returns the available personas and goal modules.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    return { ...(await getCoachProfile(userEmail)), readout: await getReadout(userEmail), personas: PERSONAS, goalModules: GOAL_MODULES };
  },
});
