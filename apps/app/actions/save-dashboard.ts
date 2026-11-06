import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";
import { dashboardConfigSchema, WIDGET_CATALOG } from "../shared/dashboard";

export default defineAction({
  description: `Save one whole dashboard (the one the user is looking at: view-screen → navigation.dashboardId). get-dashboard first, edit its widgets, save them back with the updatedAt you read as expectedUpdatedAt (the save is rejected if the dashboard changed meanwhile). Every save keeps the previous version (list-dashboard-revisions / restore-dashboard-revision undo it). Array order is page order; at most 12 widgets.
Widgets (all read through get-health):
${WIDGET_CATALOG}
Compose from the user's goals (get-coach-profile goal modules list their relevant metrics) and what data actually exists (get-health).`,
  schema: z.object({
    dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe),
    title: z.string().trim().min(1).max(80).default("Dashboard"),
    config: dashboardConfigSchema,
    expectedUpdatedAt: z.string().optional(),
  }),
  run: async ({ dashboardId, title, config, expectedUpdatedAt }, ctx) => {
    const owner = await requireOwner(ctx);
    const current = await requireDashboard(dashboardId, owner);
    // The store's own conditional write (expectedUpdatedAt) needs an affected-row count, which core 0.198–0.201 doesn't
    // read from the postgres.js driver (it returns `count`), so every guarded save failed on Postgres. Check here
    // instead (docs/upstream/agent-native-dashboard-storage-affected-rows.md); one owner per dashboard keeps the
    // read-then-write window harmless.
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      fail("The dashboard changed meanwhile — read it again with get-dashboard and retry.", { statusCode: 409, errorCode: "conflict" });
    }
    return dashboardStore.write({ id: dashboardId, kind: "health", title, config }, ownerAccess(owner));
  },
});
