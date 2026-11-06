import { fail } from "@agent-native/core/action";
import { resolveOrgIdForEmail } from "@agent-native/core/org";

import type { OwnerScope } from "./devices";

/**
 * Resolves the signed-in owner from an action context; device data is never available anonymously.
 * CLI calls carry no org, so fall back to the user's active org to keep rows tenant-scoped.
 */
export async function requireOwner(ctx: { userEmail?: string | null; orgId?: string | null } | undefined): Promise<OwnerScope> {
  if (!ctx?.userEmail) fail("Sign in required", { statusCode: 401, errorCode: "unauthorized" });
  return { userEmail: ctx.userEmail, orgId: ctx.orgId ?? (await resolveOrgIdForEmail(ctx.userEmail)) };
}
