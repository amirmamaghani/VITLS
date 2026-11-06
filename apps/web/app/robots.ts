import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/app-url";

/**
 * Everything is public. AI search and assistant crawlers are named explicitly so the
 * intent is unambiguous: VITLS wants to be found and cited by them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      {
        userAgent: [
          "OAI-SearchBot",
          "GPTBot",
          "ChatGPT-User",
          "Claude-SearchBot",
          "ClaudeBot",
          "Claude-User",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot-Extended",
          "Bingbot",
        ],
        allow: "/",
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
