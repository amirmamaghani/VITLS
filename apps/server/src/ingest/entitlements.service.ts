/**
 * The single entitlement seam (decision D9), simplified for the single-tenant server: there is no
 * org settings store, so the plan comes only from VITLS_DEFAULT_PLAN (premium → premium, else free).
 * Billing can replace this with a per-user lookup later without changing callers.
 */
import { Injectable } from "@nestjs/common";

import type { Entitlements } from "./ingest.service";

export type Plan = "free" | "premium";

const PLANS: Record<Plan, Entitlements> = {
  free: { intraday: false, rawRetentionDays: 30 },
  premium: { intraday: true, rawRetentionDays: 365 },
};

@Injectable()
export class EntitlementsService {
  async getEntitlements(): Promise<Entitlements & { plan: Plan }> {
    // guard:allow-env-credential — deploy-level plan default for dev/self-hosting, not a credential
    const plan: Plan = process.env.VITLS_DEFAULT_PLAN === "premium" ? "premium" : "free";
    return { plan, ...PLANS[plan] };
  }
}
