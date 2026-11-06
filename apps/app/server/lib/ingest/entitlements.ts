/**
 * The single entitlement seam (decision D9). v1 reads the org setting `vitls-plan` ({ plan: "free" | "premium" });
 * billing will write the same setting later. `VITLS_DEFAULT_PLAN` sets the fallback (e.g. premium in local dev).
 */
import { getOrgSetting } from "@agent-native/core/settings";

import type { Entitlements } from "./ingest";

export type Plan = "free" | "premium";

const PLANS: Record<Plan, Entitlements> = {
  free: { intraday: false, rawRetentionDays: 30 },
  premium: { intraday: true, rawRetentionDays: 365 },
};

export async function getEntitlements(scope: { orgId: string | null }): Promise<Entitlements & { plan: Plan }> {
  // guard:allow-env-credential — deploy-level plan default for dev/self-hosting, not a credential
  const fallback: Plan = process.env.VITLS_DEFAULT_PLAN === "premium" ? "premium" : "free";
  const setting = scope.orgId ? await getOrgSetting(scope.orgId, "vitls-plan") : null;
  const plan: Plan = setting?.plan === "premium" || setting?.plan === "free" ? setting.plan : fallback;
  return { plan, ...PLANS[plan] };
}
