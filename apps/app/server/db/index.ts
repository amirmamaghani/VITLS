import { createHash } from "node:crypto";

import { createDashboardStorage } from "@agent-native/core/dashboard-storage";
import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";

import type { DashboardConfig } from "../../shared/dashboard";
import * as schema from "./schema";

export const getDb = createGetDb(schema);
export { schema };

export const dashboardStore = createDashboardStorage<"health", DashboardConfig>({
  schema: { dashboards: schema.dashboards, dashboardRevisions: schema.dashboardRevisions, dashboardShares: schema.dashboardShares },
  getDb,
  resourceType: "vitls-dashboard",
  displayName: "Dashboard",
  validateKind: (kind): kind is "health" => kind === "health",
  getResourcePath: ({ id }) => `/dashboard/${id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
});
dashboardStore.registerShareable();

/** Sharing access context for the owner (framework uses undefined, not null, for "no org"). */
export const ownerAccess = (owner: { userEmail: string; orgId: string | null }) => ({ userEmail: owner.userEmail, orgId: owner.orgId ?? undefined });

/** The default dashboard, created by list-dashboards when the owner has none (one per user and org, stable id). */
export function dashboardId(owner: { userEmail: string; orgId: string | null }): string {
  return `dashboard-${createHash("sha256").update(`${owner.orgId ?? "personal"}:${owner.userEmail}`).digest("hex").slice(0, 24)}`;
}

/**
 * Health data belongs to the person, never to the organization. The framework's default offboarding
 * TRANSFERS owner_email rows to another member (e.g. a coach/admin); for health data, credentials and coach
 * memory that would hand one person's PHI to someone else. Removing a member therefore deletes their rows
 * scoped to that organization (org_id), and an email change re-keys them.
 */
const PERSONAL_HEALTH_TABLES = [
  "health_sources",
  "daily_metrics",
  "point_metrics",
  "sleep_sessions",
  "workouts",
  "intraday_series",
  "ingest_batches",
  "device_pairings",
  "device_tokens",
  // coach_facts (migration v9) is unused: coach memory lives in framework memory (docs/design/03-coach.md §2).
  "coach_facts",
  "vitls_dashboards",
  "vitls_dashboard_revisions",
  "meals",
  "meal_items",
] as const;

registerIdentityColumns(
  PERSONAL_HEALTH_TABLES.map((table) => ({
    table,
    column: "owner_email",
    emailChange: "rekey" as const,
    offboard: "delete" as const,
    reason: "Personal health data and device credentials; never transferred to another member.",
  })),
);

// A user's own foods (created_by) are personal too; reference foods have created_by NULL.
registerIdentityColumns([
  { table: "foods", column: "created_by", emailChange: "rekey", offboard: "delete", reason: "A user's own custom foods." },
]);
