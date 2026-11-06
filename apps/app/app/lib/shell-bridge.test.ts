import { afterEach, describe, expect, it, vi } from "vitest";

import { latestStatus, pairCodeFrom, parseFromShell, postToShell, subscribeStatus, trackShellStatus } from "./shell-bridge";

describe("shell bridge parsing", () => {
  it("accepts a v1 sync-status", () => {
    expect(parseFromShell(JSON.stringify({ v: 1, type: "sync-status", lastSyncAt: "2026-10-10T07:00:00Z" }))).toEqual({
      v: 1,
      type: "sync-status",
      lastSyncAt: "2026-10-10T07:00:00Z",
    });
  });
  it("ignores other versions, unknown types and junk", () => {
    expect(parseFromShell(JSON.stringify({ v: 2, type: "sync-status" }))).toBeNull();
    expect(parseFromShell(JSON.stringify({ v: 1, type: "reboot" }))).toBeNull();
    expect(parseFromShell("{not json")).toBeNull();
    expect(parseFromShell(42)).toBeNull();
  });
});

describe("pairCodeFrom", () => {
  it("accepts a plausible code", () => {
    expect(pairCodeFrom({ code: "abcdefghijkl" })).toBe("abcdefghijkl");
  });
  it("rejects missing, short and non-string codes and junk results", () => {
    expect(pairCodeFrom({})).toBeNull();
    expect(pairCodeFrom({ code: "short" })).toBeNull();
    expect(pairCodeFrom({ code: 123456789012 })).toBeNull();
    expect(pairCodeFrom(null)).toBeNull();
    expect(pairCodeFrom(undefined)).toBeNull();
  });
});

describe("sync-status store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the latest status for late subscribers and notifies current ones", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", new EventTarget());
    const stop = trackShellStatus();
    const send = (m: unknown) => win.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(m) }));

    send({ v: 1, type: "sync-status", deviceId: "dev-1" });
    expect(latestStatus()).toEqual({ v: 1, type: "sync-status", deviceId: "dev-1" }); // a card mounting now starts here

    const seen: unknown[] = [];
    const unsubscribe = subscribeStatus((m) => seen.push(m));
    send({ v: 1, type: "sync-status", deviceId: "dev-1", lastSyncAt: "2026-10-10T08:00:00Z" });
    send({ v: 1, type: "reboot" });
    expect(seen).toEqual([{ v: 1, type: "sync-status", deviceId: "dev-1", lastSyncAt: "2026-10-10T08:00:00Z" }]);
    unsubscribe();
    stop();
  });
});

describe("postToShell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends pair with the signed-in e-mail inside the shell", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { vitlsShell: { v: 1, platform: "ios" }, ReactNativeWebView: { postMessage } });
    postToShell({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM", email: "lea@example.com" });
    expect(JSON.parse(postMessage.mock.calls[0]![0] as string)).toEqual({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM", email: "lea@example.com" });
  });
});
