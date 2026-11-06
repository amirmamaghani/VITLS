import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runWithOwner } from "../common/field-crypto-context";
import { configureFieldKeys, openValue, parseFieldKeys, sealValue } from "./encrypted";

const key = () => randomBytes(32).toString("base64");
const AAD = "sleep_sessions.stages";

describe("field encryption", () => {
  beforeEach(() => configureFieldKeys(parseFieldKeys(`k1:${key()}`)));
  afterEach(() => configureFieldKeys(undefined));

  it("round-trips a value sealed inside an owner context", () => {
    const sealed = runWithOwner("a@b.co", () => sealValue("deep sleep 1h", AAD));
    expect(sealed.startsWith("enc:v1:k1:")).toBe(true);
    expect(sealed).not.toContain("deep sleep");
    expect(openValue(sealed, AAD)).toBe("deep sleep 1h");
  });

  it("decrypts without an owner context (scope is stored in the envelope)", () => {
    const sealed = runWithOwner("a@b.co", () => sealValue("x", AAD));
    expect(openValue(sealed, AAD)).toBe("x");
  });

  it("fails closed: refuses to seal outside an owner context", () => {
    expect(() => sealValue("x", AAD)).toThrow(/owner context/i);
  });

  it("uses a different derived key per owner", () => {
    const a = runWithOwner("a@b.co", () => sealValue("same", AAD));
    const b = runWithOwner("c@d.co", () => sealValue("same", AAD));
    const tamperedScope = a.replace(a.split(":")[3]!, b.split(":")[3]!);
    expect(() => openValue(tamperedScope, AAD)).toThrow();
  });

  it("binds ciphertext to its table.column via AAD (scope mismatch fails)", () => {
    const sealed = runWithOwner("a@b.co", () => sealValue("x", "workouts.sets"));
    expect(() => openValue(sealed, "sleep_sessions.stages")).toThrow();
  });

  it("detects tampering", () => {
    const sealed = runWithOwner("a@b.co", () => sealValue("x", AAD));
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
    const old = runWithOwner("a@b.co", () => sealValue("old", AAD));
    configureFieldKeys(parseFieldKeys(`k2:${key()},k1:${k1}`));
    const fresh = runWithOwner("a@b.co", () => sealValue("new", AAD));
    expect(fresh.startsWith("enc:v1:k2:")).toBe(true);
    expect(openValue(old, AAD)).toBe("old");
  });

  it("fails clearly when no keys are configured", () => {
    configureFieldKeys(parseFieldKeys(""));
    expect(() => runWithOwner("a@b.co", () => sealValue("x", AAD))).toThrow(/VITLS_FIELD_KEYS/);
  });

  it("never echoes key material for malformed entries", () => {
    const secret = key();
    expect(() => parseFieldKeys(secret)).toThrow(/entry #1 is malformed/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseFieldKeys(`k1:${randomBytes(16).toString("base64")}`)).toThrow(/32 bytes/);
  });
});
