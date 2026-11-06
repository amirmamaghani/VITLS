/**
 * Device pairing and write-only device tokens for the companion app and dev sources.
 * Only SHA-256 hashes of codes and tokens are stored.
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { HttpException, Injectable } from "@nestjs/common";
import { and, count, eq, gt, isNull } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { LIMITS } from "../common/rate-limit/limits";
import { PushService } from "./push.service";
import { devicePairings, deviceTokens, healthSources } from "../db/schema";

export interface DeviceInfo {
  platform: string;
  model?: string;
  appVersion?: string;
}

export interface DeviceIdentity {
  deviceId: string;
  userEmail: string;
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

const fail = (error: string, errorCode: string, status: number): never => {
  throw new HttpException({ error, errorCode }, status);
};

@Injectable()
export class DevicesService {
  constructor(
    private readonly dbs: DbService,
    private readonly push: PushService,
  ) {}

  /** Creates a one-time pairing code for the signed-in user (shown once, valid 10 minutes). */
  async createPairing(ownerEmail: string, opts: { ttlMs?: number } = {}): Promise<{ code: string; expiresAt: string }> {
    const now = new Date();
    const { db } = this.dbs;
    const [open] = await db
      .select({ n: count() })
      .from(devicePairings)
      .where(
        and(
          eq(devicePairings.ownerEmail, ownerEmail),
          isNull(devicePairings.consumedAt),
          gt(devicePairings.expiresAt, now.toISOString()),
        ),
      );
    if ((open?.n ?? 0) >= LIMITS.openPairingsPerUser) {
      fail("Too many open pairing codes; use or let one expire first", "too_many_pairings", 429);
    }
    const code = generateCode();
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? PAIRING_TTL_MS)).toISOString();
    await db.insert(devicePairings).values({
      id: randomUUID(),
      codeHash: sha256(normalizeCode(code)),
      expiresAt,
      createdAt: now.toISOString(),
      ownerEmail,
    });
    return { code, expiresAt };
  }

  /** Atomically consumes a pairing code and issues a device token (returned once, never stored). */
  async redeemPairing(code: string, device: DeviceInfo): Promise<{ token: string; deviceId: string }> {
    const now = new Date().toISOString();
    const { db } = this.dbs;
    // Unauthenticated redemption; the secret code hash is the credential.
    const [pairing] = await db
      .update(devicePairings)
      .set({ consumedAt: now })
      .where(
        and(
          eq(devicePairings.codeHash, sha256(normalizeCode(code))),
          isNull(devicePairings.consumedAt),
          gt(devicePairings.expiresAt, now),
        ),
      )
      .returning({ ownerEmail: devicePairings.ownerEmail });
    if (!pairing) return fail("Pairing code is invalid or expired", "invalid_pairing_code", 400);
    return this.issueToken(pairing.ownerEmail, device);
  }

  /** Pairs the current phone over its own session — no code. The signed-in native app calls this so a
      user never types a code into the same phone they're signed in on. */
  async selfPair(ownerEmail: string, device: DeviceInfo): Promise<{ token: string; deviceId: string }> {
    return this.issueToken(ownerEmail, device);
  }

  /** Issues a write-only device token (returned once, only its hash is stored). */
  private async issueToken(ownerEmail: string, device: DeviceInfo): Promise<{ token: string; deviceId: string }> {
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const deviceId = randomUUID();
    await this.dbs.db.insert(deviceTokens).values({
      id: deviceId,
      tokenHash: sha256(token),
      tokenPrefix: token.slice(0, 10),
      label: device.model ?? device.platform,
      platform: device.platform,
      createdAt: new Date().toISOString(),
      ownerEmail,
    });
    return { token, deviceId };
  }

  /** Resolves a raw bearer token to its owner; null when unknown, malformed or revoked. */
  async authenticateDeviceToken(token: string): Promise<DeviceIdentity | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    // Authentication step: lookup by secret token hash, before any owner is known.
    const [row] = await this.dbs.db
      .select({ id: deviceTokens.id, ownerEmail: deviceTokens.ownerEmail, scope: deviceTokens.scope })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.tokenHash, sha256(token)), isNull(deviceTokens.revokedAt)));
    if (!row) return null;
    return { deviceId: row.id, userEmail: row.ownerEmail, scope: row.scope };
  }

  async touchDevice(deviceId: string, ownerEmail: string): Promise<void> {
    await this.dbs.db
      .update(deviceTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(and(eq(deviceTokens.id, deviceId), eq(deviceTokens.ownerEmail, ownerEmail)));
  }

  /** Lists the user's paired devices (no token material). */
  async listDevices(ownerEmail: string) {
    return this.dbs.db
      .select({
        id: deviceTokens.id,
        label: deviceTokens.label,
        platform: deviceTokens.platform,
        tokenPrefix: deviceTokens.tokenPrefix,
        createdAt: deviceTokens.createdAt,
        lastUsedAt: deviceTokens.lastUsedAt,
        revokedAt: deviceTokens.revokedAt,
      })
      .from(deviceTokens)
      .where(eq(deviceTokens.ownerEmail, ownerEmail))
      .orderBy(deviceTokens.createdAt);
  }

  /** Revokes one of the user's devices and marks its sources revoked. and drops its push tokens. */
  async revokeDevice(ownerEmail: string, deviceId: string): Promise<void> {
    const { db } = this.dbs;
    const revoked = await db
      .update(deviceTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(deviceTokens.id, deviceId), eq(deviceTokens.ownerEmail, ownerEmail)))
      .returning({ id: deviceTokens.id });
    if (revoked.length === 0) fail("Device not found", "not_found", 404);
    await db
      .update(healthSources)
      .set({ status: "revoked" })
      .where(and(eq(healthSources.deviceTokenId, deviceId), eq(healthSources.ownerEmail, ownerEmail)));
    await this.push.removeExpoTokensForDevice(ownerEmail, deviceId);
  }
}
