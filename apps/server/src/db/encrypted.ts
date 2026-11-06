/**
 * Transparent application-level field encryption for Drizzle columns.
 *
 *   stages: encryptedJson<SleepStage[]>("sleep_sessions", "stages")
 *
 * Values are sealed with AES-256-GCM using a key derived per owner (HKDF over a master key,
 * salt = owner email) and bound to `table.column` via AAD.
 * Stored format: `enc:v1:<keyId>:<scope>:<iv>:<ciphertext+tag>` (base64url parts).
 *
 * Writes require an owner context (fail closed). Reads use the scope stored in the envelope,
 * so a value stays readable regardless of which owner context reads it (row access is enforced
 * separately by owner scoping).
 *
 * Master keys come from VITLS_FIELD_KEYS="k2:<base64>,k1:<base64>" (first = active). Rotate by
 * prepending a new key; older key ids keep decrypting until a re-encryption job rewrites them.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { customType } from "drizzle-orm/pg-core";

import { currentOwner } from "../common/field-crypto-context";

const PREFIX = "enc";
const VERSION = "v1";
const HKDF_INFO = "vitls-field:v1";

export interface FieldKeyRing {
  activeId: string | undefined;
  keys: Map<string, Buffer>;
}

export function parseFieldKeys(raw: string): FieldKeyRing {
  const keys = new Map<string, Buffer>();
  let activeId: string | undefined;
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const [index, entry] of entries.entries()) {
    // Never echo entry contents in errors: a malformed entry may be a bare key.
    const sep = entry.indexOf(":");
    const id = sep > 0 ? entry.slice(0, sep) : "";
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error(`VITLS_FIELD_KEYS entry #${index + 1} is malformed (expected "<id>:<base64 key>")`);
    const key = Buffer.from(entry.slice(sep + 1), "base64");
    if (key.length !== 32) throw new Error(`Field key "${id}" must be 32 bytes (base64), got ${key.length}`);
    keys.set(id, key);
    activeId ??= id;
  }
  return { activeId, keys };
}

let configured: FieldKeyRing | undefined;

/** Overrides the key ring (tests, KMS loader). `undefined` re-reads VITLS_FIELD_KEYS on next use. */
export function configureFieldKeys(ring: FieldKeyRing | undefined): void {
  configured = ring;
  derived.clear();
}

function keyRing(): FieldKeyRing {
  // guard:allow-env-credential — master key ring for field encryption, read once and never logged
  configured ??= parseFieldKeys(process.env.VITLS_FIELD_KEYS ?? "");
  return configured;
}

const derived = new Map<string, Buffer>();

function ownerKey(keyId: string, scope: string): Buffer {
  const cacheKey = `${keyId}\u0000${scope}`;
  let key = derived.get(cacheKey);
  if (!key) {
    const master = keyRing().keys.get(keyId);
    if (!master) throw new Error(`Unknown field key id "${keyId}" — is VITLS_FIELD_KEYS complete?`);
    key = Buffer.from(hkdfSync("sha256", master, scope, HKDF_INFO, 32));
    derived.set(cacheKey, key);
  }
  return key;
}

function currentScope(): string {
  const owner = currentOwner();
  if (owner) return `u:${owner}`;
  throw new Error("Encrypted fields can only be written inside an owner context (runWithOwner)");
}

/** Fails fast at boot when the key ring is missing or malformed (production must never start without it). */
export function assertFieldKeysConfigured(): void {
  if (!keyRing().activeId) throw new Error("No field encryption key configured: set VITLS_FIELD_KEYS (pnpm keys:generate)");
}

export function sealValue(plaintext: string, aad: string): string {
  const { activeId } = keyRing();
  if (!activeId) throw new Error("No field encryption key configured: set VITLS_FIELD_KEYS (pnpm keys:generate)");
  const scope = currentScope();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ownerKey(activeId, scope), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const b64 = (b: Buffer) => b.toString("base64url");
  return [PREFIX, VERSION, activeId, b64(Buffer.from(scope)), b64(iv), b64(ct)].join(":");
}

export function openValue(stored: string, aad: string): string {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    // Plaintext in an encrypted column means something bypassed the adapter (e.g. raw SQL).
    throw new Error(`Value in encrypted column ${aad} is not encrypted`);
  }
  const [, version, keyId, scopeB64, ivB64, ctB64] = parts as [string, string, string, string, string, string];
  if (version !== VERSION) throw new Error(`Unsupported field encryption version "${version}"`);
  const scope = Buffer.from(scopeB64, "base64url").toString("utf8");
  const iv = Buffer.from(ivB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  if (iv.length !== 12 || ct.length < 16) throw new Error(`Malformed ciphertext in encrypted column ${aad}`);
  const decipher = createDecipheriv("aes-256-gcm", ownerKey(keyId, scope), iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(ct.subarray(ct.length - 16));
  return Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]).toString("utf8");
}

/** Encrypted TEXT column. */
export function encryptedText(table: string, column: string) {
  const aad = `${table}.${column}`;
  return customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => sealValue(value, aad),
    fromDriver: (value) => openValue(value, aad),
  })(column);
}

/** Encrypted JSON column (stored as TEXT, per framework portability conventions). */
export function encryptedJson<T>(table: string, column: string) {
  const aad = `${table}.${column}`;
  return customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => sealValue(JSON.stringify(value), aad),
    fromDriver: (value) => JSON.parse(openValue(value, aad)) as T,
  })(column);
}
