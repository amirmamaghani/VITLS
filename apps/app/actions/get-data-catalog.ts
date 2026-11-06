import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDataCatalog } from "../server/lib/health/catalog";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "What health data exists for the signed-in user: connected sources (provider, via, last sync, row count), every catalog metric with its row count and first/last day, and the sleep / workouts / meals sections. Use it to answer 'what do you know about me' and before get-health-raw. Read-only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => getDataCatalog((await requireOwner(ctx)).userEmail),
});
