import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Get one of the signed-in user's dashboards: title, widgets and updatedAt. Widgets are { id, kind: metric|sleep|workouts, metric?, view?, range, bucket?, title?, wide? }. Empty until first saved. Read it before save-dashboard.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ dashboardId }, ctx) => requireDashboard(dashboardId, await requireOwner(ctx)),
});
