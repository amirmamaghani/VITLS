import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getHealthRaw, RAW_SECTIONS } from "../server/lib/health/raw";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Unresolved health rows for one metric or section, newest first, in windows of up to 366 days ending before `before` (YYYY-MM-DD, exclusive; default tomorrow). Unlike get-health, every source's row is returned and `winner` marks the one get-health would use, so you can explain why two devices disagree. `nextBefore` is the cursor for older rows (null when there are none). Read-only; never use it to change data.",
  schema: z.object({
    metric: z.string().trim().min(1).max(64).optional().describe("Catalog metric key (daily or point), e.g. steps, weight"),
    section: z.enum(RAW_SECTIONS).optional().describe("sleep | workouts | meals (instead of metric)"),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Exclusive upper day bound; pass nextBefore from the previous call to page back"),
    days: z.number().int().min(1).max(366).optional().describe("Window length in days, default 92"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => getHealthRaw(await requireOwner(ctx), args),
});
