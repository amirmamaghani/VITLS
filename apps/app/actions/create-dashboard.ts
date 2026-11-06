import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { requireOwner } from "../server/lib/ingest/owner";
import { EMPTY_DASHBOARD } from "../shared/dashboard";

export default defineAction({
  description:
    "Create an empty dashboard with its own chat (e.g. a separate board for a race or a cut). Returns the dashboard; fill it with save-dashboard. The user can also create one from the sidebar.",
  schema: z.object({ title: z.string().trim().min(1).max(80) }),
  run: async ({ title }, ctx) => {
    const owner = await requireOwner(ctx);
    return dashboardStore.write({ id: `dashboard-${randomUUID()}`, kind: "health", title, config: EMPTY_DASHBOARD }, ownerAccess(owner));
  },
});
