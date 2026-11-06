/** Where "Get early access" leads: the VITLS app (apps/app runs on :8081 locally). */
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8081";

/** Public origin of this marketing site (hreflang and OG URLs). */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vitls.ai";
