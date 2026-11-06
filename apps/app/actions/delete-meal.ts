import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwner } from "../server/lib/ingest/owner";
import { deleteMeal } from "../server/lib/meals/meals";

export default defineAction({
  description: "Delete a meal from the user's food log (and update that day's intake totals). Confirm with the user first unless they asked for it.",
  schema: z.object({ mealId: z.string() }),
  run: async ({ mealId }, ctx) => deleteMeal(await requireOwner(ctx), mealId),
});
