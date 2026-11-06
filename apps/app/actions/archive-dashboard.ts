import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "Archive a dashboard and hide its chat. The last remaining dashboard cannot be archived.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  run: async ({ dashboardId }, ctx) => {
    const owner = await requireOwner(ctx);
    const dashboard = await requireDashboard(dashboardId, owner);
    // Only the owner archives (shared viewers read); the store lowercases owner_email on write.
    if (dashboard.ownerEmail !== owner.userEmail.toLowerCase()) fail("Dashboard not found", { statusCode: 404, errorCode: "not_found" });
    // docs/upstream/agent-native-dashboard-storage-no-archive.md: the store reads archived_at but has no writer for it.
    // One conditional statement, so two concurrent archives cannot both pass a separate "last dashboard" check.
    const { dashboards } = schema;
    const archived = await getDb()
      .update(dashboards)
      .set({ archivedAt: new Date().toISOString() })
      .where(
        and(
          eq(dashboards.id, dashboardId),
          isNull(dashboards.archivedAt),
          sql`(select count(*) from vitls_dashboards d where d.owner_email = ${dashboards.ownerEmail} and d.org_id is not distinct from ${dashboards.orgId} and d.archived_at is null) > 1`,
        ),
      )
      .returning({ id: dashboards.id });
    if (archived.length === 0) fail("The last dashboard cannot be archived", { statusCode: 409, errorCode: "conflict" });
    return { id: dashboardId };
  },
});
