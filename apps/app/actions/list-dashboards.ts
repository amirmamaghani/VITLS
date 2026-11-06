import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { dashboardId, dashboardStore, getDb, ownerAccess, schema } from "../server/db";
import { requireOwner } from "../server/lib/ingest/owner";
import { EMPTY_DASHBOARD } from "../shared/dashboard";

/** The only place that guarantees the first dashboard exists; every other dashboard action assumes it. */
export default defineAction({
  description:
    "List the signed-in user's dashboards ({ id, title, updatedAt }[], most recently updated first). Each dashboard has its own chat with you. Never empty: the default dashboard is created on first call.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const owner = await requireOwner(ctx);
    const access = ownerAccess(owner);
    let boards = await dashboardStore.list(access);
    if (boards.length === 0) {
      const id = dashboardId(owner);
      // The default row may exist archived (every dashboard archived); the store's write would update it in place.
      const existing = await dashboardStore.get(id, access);
      if (existing?.archivedAt) await getDb().update(schema.dashboards).set({ archivedAt: null }).where(eq(schema.dashboards.id, id));
      else await dashboardStore.write({ id, kind: "health", title: "Dashboard", config: EMPTY_DASHBOARD }, access);
      boards = await dashboardStore.list(access);
    }
    return boards.map(({ id, title, updatedAt }: { id: string; title: string; updatedAt: string }) => ({ id, title, updatedAt }));
  },
});
