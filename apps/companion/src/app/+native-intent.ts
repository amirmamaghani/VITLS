import { isAuthPath, rememberDirectLink, sameOrigin } from "../bridge";

const SERVER = process.env.EXPO_PUBLIC_VITLS_SERVER ?? "";

/**
 * Routes incoming links: App/Universal Links on our origin and vitls://open go to the Coach tab; everything else is untouched.
 * Only a direct https link may carry a sign-in path (the magic link): vitls://open with one lands on Coach without a url,
 * so nobody can sign the WebView into their own account with a custom-scheme link (login CSRF).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (SERVER && sameOrigin(path, SERVER)) {
      rememberDirectLink(path);
      return `/coach?url=${encodeURIComponent(path)}`;
    }
    if (path.startsWith("vitls://open")) {
      const target = new URL(path).searchParams.get("url") ?? "/home";
      if (isAuthPath(target, SERVER || "https://invalid.local")) return "/coach";
      return `/coach?url=${encodeURIComponent(target)}`;
    }
  } catch {
    // fall through to the unchanged path
  }
  return path;
}
