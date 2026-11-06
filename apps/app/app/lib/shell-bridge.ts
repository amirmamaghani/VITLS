/** postMessage bridge between the PWA and the companion WebView. Three message types, versioned, unknown ones dropped. */
import { z } from "zod";

import { isShell } from "../../shared/shell";

/** `email` is the signed-in account; the companion shows it in a native "send health data to …?" confirmation before pairing. */
export type BridgeOut = { v: 1; type: "pair"; code: string; email: string } | { v: 1; type: "sync-now" };
const bridgeIn = z.object({ v: z.literal(1), type: z.literal("sync-status"), lastSyncAt: z.string().optional(), lastError: z.string().optional(), deviceId: z.string().optional() });
export type BridgeIn = z.infer<typeof bridgeIn>;

export function postToShell(message: BridgeOut): void {
  if (!isShell()) return;
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

export function parseFromShell(raw: unknown): BridgeIn | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = bridgeIn.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function onShellMessage(handler: (m: BridgeIn) => void): () => void {
  const listener = (e: Event) => {
    const m = parseFromShell((e as MessageEvent).data);
    if (m) handler(m);
  };
  window.addEventListener("message", listener);
  document.addEventListener("message", listener);
  return () => {
    window.removeEventListener("message", listener);
    document.removeEventListener("message", listener);
  };
}

/** The pairing code from a create-device-pairing result, or null when the response is malformed. */
export function pairCodeFrom(result: unknown): string | null {
  const code = (result as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code.length >= 12 ? code : null;
}

/**
 * Latest sync-status from the companion. Native pushes it on every page load, usually before the settings card mounts,
 * so the root-mounted ShellBridge records it here and late subscribers start from it.
 */
let latest: BridgeIn | undefined;
const subscribers = new Set<(m: BridgeIn) => void>();

export const latestStatus = (): BridgeIn | undefined => latest;

/** Installed once by the root-mounted ShellBridge; returns the cleanup. */
export function trackShellStatus(): () => void {
  return onShellMessage((m) => {
    latest = m;
    subscribers.forEach((fn) => fn(m));
  });
}

export function subscribeStatus(fn: (m: BridgeIn) => void): () => void {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
}
