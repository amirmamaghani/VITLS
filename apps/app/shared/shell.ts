/** "Shell mode": the PWA runs inside the companion app's WebView. No prices, plans or purchase links are shown there. */
const SHELL_UA = "VITLSCompanion/";

declare global {
  interface Window {
    vitlsShell?: { v: number; platform: string };
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

export function isShellUserAgent(ua: string | undefined | null): boolean {
  return typeof ua === "string" && ua.includes(SHELL_UA);
}

export function isShell(): boolean {
  return typeof window !== "undefined" && window.vitlsShell?.v === 1;
}
