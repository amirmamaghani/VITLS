/** Shared plumbing for the device-facing ingest routes (no cookies, bearer device tokens, JSON errors). */
import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core/action";
import { isOrgMember } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { getHeader, getRequestIP, getRequestURL, setResponseStatus, type H3Event } from "h3";
import { ZodError } from "zod";

import { authenticateDeviceToken, type DeviceIdentity } from "./devices";
import { hitRateLimit, LIMITS } from "./rate-limit";

const tooMany = (message: string) => new ActionContractError(message, { errorCode: "rate_limited", statusCode: 429 });

/**
 * Authenticates a device token, re-checks org membership (a member removed from an org loses its tokens'
 * access to that tenant) and counts the request toward the per-device limit before any body is read.
 */
export async function requireDevice(event: H3Event): Promise<DeviceIdentity> {
  const header = getHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const identity = match ? await authenticateDeviceToken(match[1]!) : null;
  if (!identity) throw new ActionContractError("Invalid or revoked device token", { errorCode: "unauthorized", statusCode: 401 });
  if (identity.scope !== "ingest:write") throw new ActionContractError("Token not allowed to ingest", { errorCode: "forbidden", statusCode: 403 });
  // Federated orgs validate membership against the identity hub, which needs the request origin in context.
  const orgId = identity.orgId;
  const member = orgId
    ? await runWithRequestContext({ userEmail: identity.userEmail, orgId, requestOrigin: getRequestURL(event).origin }, () =>
        isOrgMember(orgId, identity.userEmail),
      )
    : true;
  if (!member) {
    throw new ActionContractError("Device owner is no longer a member of this organization", { errorCode: "forbidden", statusCode: 403 });
  }
  if (!(await hitRateLimit(`ingest:req:${identity.deviceId}`, LIMITS.ingestRequests))) throw tooMany("Too many requests, slow down");
  return identity;
}

/** Counts body bytes toward the per-device daily quota (call with Content-Length before reading the body). */
export async function chargeIngestBytes(identity: DeviceIdentity, bytes: number): Promise<void> {
  if (!(await hitRateLimit(`ingest:bytes:${identity.deviceId}`, LIMITS.ingestBytes, bytes))) {
    throw tooMany("Daily ingest quota exceeded for this device");
  }
}

/**
 * Client address for throttling. Only platform-set headers are trusted (Netlify's connection IP); the
 * client-controlled X-Forwarded-For is ignored so it cannot be rotated to dodge the per-client limit.
 */
function clientAddress(event: H3Event): string {
  return getHeader(event, "x-nf-client-connection-ip") ?? getRequestIP(event) ?? "unknown";
}

/** Throttles unauthenticated pairing redemption globally (resource backstop) and per client. */
export async function throttleRedeem(event: H3Event): Promise<void> {
  if (!(await hitRateLimit("redeem:global", LIMITS.redeemGlobal))) throw tooMany("Pairing is busy, try again in a minute");
  const client = createHash("sha256").update(clientAddress(event)).digest("hex").slice(0, 32);
  if (!(await hitRateLimit(`redeem:client:${client}`, LIMITS.redeemPerClient))) {
    throw tooMany("Too many pairing attempts, try again in a minute");
  }
}

/** Runs a device route handler and maps failures to small JSON errors without leaking internals. */
export async function deviceRoute<T>(event: H3Event, handler: () => Promise<T>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ActionContractError) {
      setResponseStatus(event, error.statusCode);
      return { error: error.message, errorCode: error.errorCode };
    }
    if (error instanceof ZodError) {
      setResponseStatus(event, 400);
      return {
        error: "Invalid payload",
        errorCode: "invalid_payload",
        issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    }
    if (error instanceof SyntaxError) {
      setResponseStatus(event, 400);
      return { error: "Malformed JSON", errorCode: "invalid_json" };
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) {
      setResponseStatus(event, 413);
      return { error: "Payload too large", errorCode: "payload_too_large" };
    }
    // Log only the error class/code: messages from parsers and the DB driver can echo request data (PHI, codes).
    console.error("[ingest] unexpected error", (error as Error)?.name, (error as { code?: string })?.code ?? "");
    setResponseStatus(event, 500);
    return { error: "Internal server error", errorCode: "internal" };
  }
}
