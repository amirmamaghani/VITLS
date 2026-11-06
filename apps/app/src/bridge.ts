/** Native side of the WebView bridge (spec §4): three message types, versioned, unknown ones dropped. */
/** `email` is the PWA's signed-in account, shown in the native confirmation before the code is redeemed. */
export type FromWeb = { v: 1; type: "pair"; code: string; email: string } | { v: 1; type: "sync-now" };
export type ToWeb = { v: 1; type: "sync-status"; lastSyncAt?: string; lastError?: string; deviceId?: string };

export function parseFromWeb(raw: string): FromWeb | null {
  try {
    const m = JSON.parse(raw) as { v?: unknown; type?: unknown; code?: unknown; email?: unknown };
    if (m?.v !== 1) return null;
    if (m.type === "pair" && typeof m.code === "string" && m.code.length >= 12 && m.code.length <= 20 && typeof m.email === "string" && m.email.length > 0 && m.email.length <= 200)
      return { v: 1, type: "pair", code: m.code, email: m.email };
    if (m.type === "sync-now") return { v: 1, type: "sync-now" };
    return null;
  } catch {
    return null;
  }
}

export const injectToWeb = (m: ToWeb) => `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(JSON.stringify(m))}}));true;`;
export const SHELL_INIT = (platform: string) => `window.vitlsShell={v:1,platform:${JSON.stringify(platform)}};true;`;

/** True only when both URLs share scheme, host and port (a prefix check lets `https://host.evil.com` and `https://host@evil.com` through). */
export function sameOrigin(url: string, server: string): boolean {
  try {
    return new URL(url).origin === new URL(server).origin;
  } catch {
    return false;
  }
}

/**
 * True when the path or URL points into the server framework's own namespace (every internal route, sign-in endpoints
 * included, lives under a first path segment that starts with "_"), however it is spelled. App pages never do.
 */
export function isAuthPath(pathOrUrl: string, server: string): boolean {
  try {
    const path = decodeURIComponent(new URL(pathOrUrl, server).pathname).replace(/\/{2,}/g, "/");
    return path.split("/")[1]?.startsWith("_") ?? false;
  } catch {
    return true; // undecodable: treat as unsafe
  }
}

/**
 * Resolves a path or URL against the server; null unless the result is on the server's origin. Sign-in URLs are
 * refused unless `allowAuth` (only a direct https App/Universal Link may sign the WebView in: a vitls:// link or push
 * payload carrying an attacker's magic link would otherwise log the victim into the attacker's account).
 */
export function serverUrl(pathOrUrl: string, server: string, allowAuth = false): string | null {
  try {
    const url = new URL(pathOrUrl, server);
    if (url.origin !== new URL(server).origin) return null;
    if (!allowAuth && isAuthPath(url.toString(), server)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The last https link that arrived directly as an App/Universal Link (set by +native-intent; route params cannot forge it). */
let directLink: string | undefined;
export const rememberDirectLink = (url: string) => void (directLink = url);
export const isDirectLink = (url: string | undefined) => url !== undefined && url === directLink;
