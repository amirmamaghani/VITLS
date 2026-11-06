import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { nutrientsSchema } from "../shared/meals";
import { requireOwner } from "../server/lib/ingest/owner";
import { createFood } from "../server/lib/meals/meals";

export default defineAction({
  description:
    "Save the user's own food (only they see it), e.g. read from a photo of a nutrition label: name, brand, barcode, nutrients per 100 g (or 100 ml) and named portions. Returns the food to use with log-meal.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(80).optional(),
    barcode: z.string().regex(/^\d{8,14}$/).optional(),
    basis: z.enum(["100g", "100ml"]).default("100g"),
    nutrients: nutrientsSchema("Per 100 g/ml, canonical units"),
    portions: z.array(z.object({ label: z.string().trim().min(1).max(80), amount: z.number().positive() })).max(10).optional(),
  }),
  run: async (input, ctx) => ({ food: await createFood(await requireOwner(ctx), input) }),
});
