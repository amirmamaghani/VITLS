import { randomBytes } from "node:crypto";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureFieldKeys, openValue, parseFieldKeys, sealValue } from "./encrypted";

const key = () => randomBytes(32).toString("base64");
const AAD = "sleep_sessions.stages";

const inOrg = <T>(orgId: string, fn: () => T) =>
  runWithRequestContext({ userEmail: "user@example.com", orgId }, fn) as T;

describe("field encryption", () => {
  beforeEach(() => configureFieldKeys(parseFieldKeys(`k1:${key()}`)));
  afterEach(() => configureFieldKeys(undefined));

  it("round-trips a value written inside a request context", () => {
    const sealed = inOrg("org_a", () => sealValue("deep sleep 1h", AAD));
    expect(sealed.startsWith("enc:v1:k1:")).toBe(true);
    expect(sealed).not.toContain("deep sleep");
    expect(openValue(sealed, AAD)).toBe("deep sleep 1h");
  });

  it("decrypts without a request context (scope is stored in the envelope)", () => {
    const sealed = inOrg("org_a", () => sealValue("x", AAD));
    expect(openValue(sealed, AAD)).toBe("x");
  });

  it("refuses to encrypt outside a request context", () => {
    expect(() => sealValue("x", AAD)).toThrow(/context/i);
  });

  it("uses a different derived key per tenant", () => {
    const a = inOrg("org_a", () => sealValue("same", AAD));
    const b = inOrg("org_b", () => sealValue("same", AAD));
    const tamperedScope = a.replace(a.split(":")[3]!, b.split(":")[3]!);
    expect(() => openValue(tamperedScope, AAD)).toThrow();
  });

  it("binds ciphertext to its column", () => {
    const sealed = inOrg("org_a", () => sealValue("x", AAD));
    expect(() => openValue(sealed, "workouts.sets")).toThrow();
  });

  it("detects tampering", () => {
    const sealed = inOrg("org_a", () => sealValue("x", AAD));
    const parts = sealed.split(":");
    const ct = Buffer.from(parts[5]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[5] = ct.toString("base64url");
    expect(() => openValue(parts.join(":"), AAD)).toThrow();
  });

  it("rejects plaintext found in an encrypted column", () => {
    expect(() => openValue("plain text", AAD)).toThrow(/not encrypted/i);
  });

  it("keeps old values readable after key rotation", () => {
    const k1 = key();
    configureFieldKeys(parseFieldKeys(`k1:${k1}`));
    const old = inOrg("org_a", () => sealValue("old", AAD));
    configureFieldKeys(parseFieldKeys(`k2:${key()},k1:${k1}`));
    const fresh = inOrg("org_a", () => sealValue("new", AAD));
    expect(fresh.startsWith("enc:v1:k2:")).toBe(true);
    expect(openValue(old, AAD)).toBe("old");
  });

  it("fails clearly when no keys are configured", () => {
    configureFieldKeys(parseFieldKeys(""));
    expect(() => inOrg("org_a", () => sealValue("x", AAD))).toThrow(/VITLS_FIELD_KEYS/);
  });

  it("never echoes key material for malformed entries", () => {
    const secret = key();
    expect(() => parseFieldKeys(secret)).toThrow(/entry #1 is malformed/);
    try {
      parseFieldKeys(secret);
    } catch (error) {
      expect((error as Error).message).not.toContain(secret.slice(0, 20));
    }
  });

  it("rejects truncated authentication tags", () => {
    const sealed = inOrg("org_a", () => sealValue("x", AAD));
    const parts = sealed.split(":");
    parts[5] = Buffer.from(parts[5]!, "base64url").subarray(0, 8).toString("base64url");
    expect(() => openValue(parts.join(":"), AAD)).toThrow(/malformed/i);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseFieldKeys(`k1:${randomBytes(16).toString("base64")}`)).toThrow(/32 bytes/);
  });
});
