import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/app-url";

/** One entry per locale page, each listing every language version (hreflang) plus x-default. */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = {
    ...Object.fromEntries(routing.locales.map((l) => [l, `${siteUrl}/${l}`])),
    "x-default": `${siteUrl}/${routing.defaultLocale}`,
  };
  const legal = {
    ...Object.fromEntries(
      routing.locales.map((l) => [l, `${siteUrl}/${l}/legal`]),
    ),
    "x-default": `${siteUrl}/${routing.defaultLocale}/legal`,
  };
  const home = routing.locales.map((locale) => ({
    url: `${siteUrl}/${locale}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: locale === routing.defaultLocale ? 1 : 0.9,
    alternates: { languages },
  }));
  const legalPages = routing.locales.map((locale) => ({
    url: `${siteUrl}/${locale}/legal`,
    lastModified: new Date(),
    changeFrequency: "yearly" as const,
    priority: 0.3,
    alternates: { languages: legal },
  }));
  const glp1 = {
    ...Object.fromEntries(routing.locales.map((l) => [l, `${siteUrl}/${l}/glp1`])),
    "x-default": `${siteUrl}/${routing.defaultLocale}/glp1`,
  };
  const glp1Pages = routing.locales.map((locale) => ({
    url: `${siteUrl}/${locale}/glp1`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.9,
    alternates: { languages: glp1 },
  }));
  return [...home, ...glp1Pages, ...legalPages];
}
