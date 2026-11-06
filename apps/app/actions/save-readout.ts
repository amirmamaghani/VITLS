import { defineAction } from "@agent-native/core/action";

import { readoutSchema, saveReadout } from "../server/lib/coach/readout";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Save today's morning readout for the dashboard header and readout widget (overwrites the previous one). date is today's date (YYYY-MM-DD) in the user's timezone. directive is one actionable sentence in the user's language. greeting (the dashboard heading, ≤ 80 chars) addresses the user by first name (get-user-profile) in the voice of their persona and strictness and any tone preference in memory, in the user's language; it may cite one fact from get-health. highlights (at most 3) each reference a metric key with a short note; never invent numbers, take them from get-health.",
  schema: readoutSchema,
  run: async (input, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    return { readout: await saveReadout(userEmail, input), message: "Readout saved." };
  },
});
