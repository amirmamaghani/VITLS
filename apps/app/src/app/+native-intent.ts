import { sameOrigin } from "../bridge";

const SERVER = process.env.EXPO_PUBLIC_VITLS_SERVER ?? "";

/**
 * Routes incoming links: App/Universal Links on our origin and vitls://open go to the native Chat tab; everything else is untouched.
 * The magic-link verify is consumed natively; the old WebView url= param is dropped.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (SERVER && sameOrigin(path, SERVER)) {
      // The native session is captured by consuming the one-time token here, so no WebView is signed in by this link.
      if (new URL(path).pathname.endsWith("/magic-link/verify")) return `/verify?url=${encodeURIComponent(path)}`;
      return "/chat";
    }
    if (path.startsWith("vitls://open")) return "/chat"; // never carries a url, so no sign-in path can ride along (login CSRF)
  } catch {
    // fall through to the unchanged path
  }
  return path;
}
