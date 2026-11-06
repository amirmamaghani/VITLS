import { fail } from "@agent-native/core/action";

import { dashboardStore, ownerAccess } from "../db";
import type { OwnerScope } from "./ingest/devices";

/** The owner's active dashboard by id; 404 for ids the owner cannot see or has archived. */
export async function requireDashboard(dashboardId: string, owner: OwnerScope) {
  const dashboard = await dashboardStore.get(dashboardId, ownerAccess(owner));
  if (!dashboard || dashboard.archivedAt) fail("Dashboard not found", { statusCode: 404, errorCode: "not_found" });
  return dashboard;
}

export const dashboardIdArg = { describe: "Dashboard id from view-screen (navigation.dashboardId) or list-dashboards" };
