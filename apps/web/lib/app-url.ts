/** Where "Get early access" leads: the VITLS app (apps/app runs on :8081 locally). */
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8081";

/** Source repository (AGPL-3.0). */
export const repoUrl = "https://github.com/amirmamaghani/VITLS";

/** Public origin of this marketing site (hreflang and OG URLs). */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vitls.ai";
