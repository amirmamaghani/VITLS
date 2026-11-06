/**
 * Device pairing and write-only device tokens for the companion app and dev sources.
 * Only SHA-256 hashes of codes and tokens are stored. See docs/design/02-data-model-and-ingest.md §5.
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, count, eq, gt, isNull } from "drizzle-orm";

import { getDb, schema } from "../../db";
import { removeExpoTokensForDevice } from "../notifications/web-push";
import { LIMITS } from "./rate-limit";

export interface OwnerScope {
  userEmail: string;
  orgId: string | null;
}

export interface DeviceInfo {
  platform: string;
  model?: string;
  appVersion?: string;
}

export interface DeviceIdentity extends OwnerScope {
  deviceId: string;
  scope: string;
}

const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const TOKEN_PREFIX = "vdt_";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeCode = (code: string) => code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** 12 symbols from a 32-symbol alphabet ≈ 60 bits, shown as XXXX-XXXX-XXXX. */
function generateCode(): string {
  const chars = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Creates a one-time pairing code for the signed-in user (shown once, valid 10 minutes). */
export async function createPairing(owner: OwnerScope, opts: { ttlMs?: number } = {}) {
  const now = new Date();
  const [open] = await getDb()
    .select({ n: count() })
    .from(schema.devicePairings)
    .where(
      and(
        eq(schema.devicePairings.ownerEmail, owner.userEmail),
        isNull(schema.devicePairings.consumedAt),
        gt(schema.devicePairings.expiresAt, now.toISOString()),
      ),
    );
  if ((open?.n ?? 0) >= LIMITS.openPairingsPerUser) {
    fail("Too many open pairing codes; use or let one expire first", { statusCode: 429, errorCode: "too_many_pairings" });
  }
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? PAIRING_TTL_MS)).toISOString();
  await getDb()
    .insert(schema.devicePairings)
    .values({
      id: randomUUID(),
      codeHash: sha256(normalizeCode(code)),
      expiresAt,
      createdAt: now.toISOString(),
      ownerEmail: owner.userEmail,
      orgId: owner.orgId,
    });
  return { code, expiresAt };
}

/** Atomically consumes a pairing code and issues a device token (returned once, never stored). */
export async function redeemPairing(code: string, device: DeviceInfo) {
  const now = new Date().toISOString();
  const db = getDb();
  // guard:allow-unscoped — unauthenticated redemption; the secret code hash is the credential
  const [pairing] = await db
    .update(schema.devicePairings)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.devicePairings.codeHash, sha256(normalizeCode(code))),
        isNull(schema.devicePairings.consumedAt),
        gt(schema.devicePairings.expiresAt, now),
      ),
    )
    .returning({ ownerEmail: schema.devicePairings.ownerEmail, orgId: schema.devicePairings.orgId });
  if (!pairing) fail("Pairing code is invalid or expired", { statusCode: 400, errorCode: "invalid_pairing_code" });

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  await db.insert(schema.deviceTokens).values({
    id: deviceId,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 10),
    label: device.model ?? device.platform,
    platform: device.platform,
    createdAt: now,
    ownerEmail: pairing.ownerEmail,
    orgId: pairing.orgId,
  });
  return { token, deviceId };
}

/** Resolves a raw bearer token to its owner; null when unknown, malformed or revoked. */
export async function authenticateDeviceToken(token: string): Promise<DeviceIdentity | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  // guard:allow-unscoped — authentication step: lookup by secret token hash, before any owner is known
  const [row] = await getDb()
    .select({
      id: schema.deviceTokens.id,
      ownerEmail: schema.deviceTokens.ownerEmail,
      orgId: schema.deviceTokens.orgId,
      scope: schema.deviceTokens.scope,
    })
    .from(schema.deviceTokens)
    .where(and(eq(schema.deviceTokens.tokenHash, sha256(token)), isNull(schema.deviceTokens.revokedAt)));
  if (!row) return null;
  return { deviceId: row.id, userEmail: row.ownerEmail, orgId: row.orgId, scope: row.scope };
}

export async function touchDevice(deviceId: string, owner: OwnerScope): Promise<void> {
  await getDb()
    .update(schema.deviceTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(and(eq(schema.deviceTokens.id, deviceId), eq(schema.deviceTokens.ownerEmail, owner.userEmail)));
}

/** Lists the user's paired devices (no token material). */
export async function listDevices(owner: OwnerScope) {
  return getDb()
    .select({
      id: schema.deviceTokens.id,
      label: schema.deviceTokens.label,
      platform: schema.deviceTokens.platform,
      tokenPrefix: schema.deviceTokens.tokenPrefix,
      createdAt: schema.deviceTokens.createdAt,
      lastUsedAt: schema.deviceTokens.lastUsedAt,
      revokedAt: schema.deviceTokens.revokedAt,
    })
    .from(schema.deviceTokens)
    .where(eq(schema.deviceTokens.ownerEmail, owner.userEmail))
    .orderBy(schema.deviceTokens.createdAt);
}

/** Revokes one of the user's devices, marks its sources revoked and drops the Expo push tokens it registered. */
export async function revokeDevice(owner: OwnerScope, deviceId: string): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const revoked = await db
    .update(schema.deviceTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.deviceTokens.id, deviceId), eq(schema.deviceTokens.ownerEmail, owner.userEmail)))
    .returning({ id: schema.deviceTokens.id });
  if (revoked.length === 0) fail("Device not found", { statusCode: 404, errorCode: "not_found" });
  await db
    .update(schema.healthSources)
    .set({ status: "revoked" })
    .where(and(eq(schema.healthSources.deviceTokenId, deviceId), eq(schema.healthSources.ownerEmail, owner.userEmail)));
  await removeExpoTokensForDevice(owner.userEmail, deviceId);
}
