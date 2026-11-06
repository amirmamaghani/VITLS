import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "Restore an earlier version of a dashboard (undo). The current version is kept as a revision.",
  schema: z.object({
    dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe),
    revisionId: z.string().trim().min(1).max(200).describe("Revision id from list-dashboard-revisions"),
  }),
  run: async ({ dashboardId, revisionId }, ctx) => {
    const owner = await requireOwner(ctx);
    await requireDashboard(dashboardId, owner);
    const restored = await dashboardStore.restore(dashboardId, revisionId, ownerAccess(owner));
    if (!restored) fail("Dashboard revision was not found", { statusCode: 404, errorCode: "not_found" });
    return restored;
  },
});
