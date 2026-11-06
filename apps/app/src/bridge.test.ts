import { describe, expect, it } from "vitest";

import { injectToWeb, isAuthPath, parseFromWeb, sameOrigin, serverUrl } from "./bridge";

describe("native side of the bridge", () => {
  it("parses v1 pair and sync-now, drops the rest", () => {
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM", email: "lea@example.com" }))).toEqual({
      v: 1,
      type: "pair",
      code: "ABCD-EFGH-JKLM",
      email: "lea@example.com",
    });
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "sync-now" }))).toEqual({ v: 1, type: "sync-now" });
    expect(parseFromWeb(JSON.stringify({ v: 2, type: "pair", code: "x" }))).toBeNull();
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "format-disk" }))).toBeNull();
    expect(parseFromWeb("nope")).toBeNull();
  });
  it("requires the account e-mail on pair (shown in the native confirmation)", () => {
    const pair = (email: unknown) => parseFromWeb(JSON.stringify({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM", email }));
    expect(pair(undefined)).toBeNull();
    expect(pair(42)).toBeNull();
    expect(pair("")).toBeNull();
    expect(pair(`${"a".repeat(190)}@example.com`)).toBeNull();
  });
  it("serialises sync-status as a MessageEvent dispatch", () => {
    const js = injectToWeb({ v: 1, type: "sync-status", lastSyncAt: "t" });
    expect(js).toContain('"type\\":\\"sync-status\\"');
    expect(js.endsWith("true;")).toBe(true);
  });
});

describe("origin checks", () => {
  const S = "https://vitls.example";
  it("sameOrigin rejects lookalike host, userinfo and malformed input", () => {
    expect(sameOrigin("https://vitls.example/home?x=1", S)).toBe(true);
    expect(sameOrigin("https://vitls.example.evil.com/x", S)).toBe(false);
    expect(sameOrigin("https://vitls.example@evil.com/x", S)).toBe(false);
    expect(sameOrigin("http://vitls.example/x", S)).toBe(false);
    expect(sameOrigin("not a url", S)).toBe(false);
    expect(sameOrigin("https://vitls.example/", "")).toBe(false);
  });
  it("serverUrl resolves paths and same-origin URLs only", () => {
    expect(serverUrl("/home", S)).toBe("https://vitls.example/home");
    expect(serverUrl("https://vitls.example/a?b=1", S)).toBe("https://vitls.example/a?b=1");
    expect(serverUrl("@evil.com/x", S)).toBe("https://vitls.example/@evil.com/x");
    expect(serverUrl("//evil.com/x", S)).toBeNull();
    expect(serverUrl("https://vitls.example.evil.com/x", S)).toBeNull();
    expect(serverUrl("https://vitls.example@evil.com/x", S)).toBeNull();
    expect(serverUrl("/x", "nope")).toBeNull();
  });
  it("serverUrl refuses sign-in paths unless explicitly allowed (direct https link only)", () => {
    const verify = "https://vitls.example/_fw/auth/link/verify?token=t";
    expect(serverUrl(verify, S)).toBeNull();
    expect(serverUrl("/_fw/auth/link/verify?token=t", S)).toBeNull();
    expect(serverUrl("/%5ffw/auth/x", S)).toBeNull();
    expect(serverUrl("/_FW//auth/x", S)).toBeNull();
    expect(serverUrl("/home/../_fw/auth/x", S)).toBeNull();
    expect(serverUrl(verify, S, true)).toBe(verify);
    expect(serverUrl("/_fw/other", S)).toBeNull(); // every "_" namespace is the framework's, never an app page
    expect(isAuthPath("/home", S)).toBe(false);
  });
});
