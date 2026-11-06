import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "List earlier versions of a dashboard (each save keeps the one it replaced), newest first.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ dashboardId }, ctx) => {
    const owner = await requireOwner(ctx);
    await requireDashboard(dashboardId, owner);
    return dashboardStore.listRevisionMetadata(dashboardId, ownerAccess(owner));
  },
});
