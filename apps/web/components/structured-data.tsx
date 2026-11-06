import { getTranslations } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import { appUrl, repoUrl, siteUrl } from "@/lib/app-url";
import { FAQ_KEYS } from "./faq";

/**
 * One schema.org @graph per locale page. Only facts that are visible on the page:
 * no ratings, reviews, prices or medical types (VITLS is coaching, not medical advice).
 */
export async function StructuredData({ locale }: { locale: Locale }) {
  const meta = await getTranslations({ locale, namespace: "meta" });
  const faq = await getTranslations({ locale, namespace: "faq" });
  const page = `${siteUrl}/${locale}`;

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#org`,
        name: "VITLS",
        legalName: "VERTISPACE s.r.o.",
        taxID: "CZ21095566",
        identifier: {
          "@type": "PropertyValue",
          propertyID: "IČO",
          value: "21095566",
        },
        email: "hey@vitls.ai",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Lidická 700/19",
          addressLocality: "Brno",
          postalCode: "602 00",
          addressCountry: "CZ",
        },
        url: siteUrl,
        sameAs: [repoUrl],
        logo: `${siteUrl}/apple-icon`,
        description: meta("appDescription"),
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "VITLS",
        url: siteUrl,
        inLanguage: [...routing.locales],
        publisher: { "@id": `${siteUrl}/#org` },
      },
      {
        "@type": "WebPage",
        "@id": `${page}#webpage`,
        url: page,
        name: meta("title"),
        description: meta("description"),
        inLanguage: locale,
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@id": `${siteUrl}/#app` },
        mainEntity: { "@id": `${page}#faq` },
        primaryImageOfPage: `${page}/opengraph-image/og`,
      },
      {
        "@type": "WebApplication",
        "@id": `${siteUrl}/#app`,
        name: "VITLS",
        url: appUrl,
        applicationCategory: "HealthApplication",
        browserRequirements: "Requires a modern web browser",
        description: meta("appDescription"),
        inLanguage: [...routing.locales],
        publisher: { "@id": `${siteUrl}/#org` },
      },
      {
        "@type": "FAQPage",
        "@id": `${page}#faq`,
        inLanguage: locale,
        mainEntity: FAQ_KEYS.map((k) => ({
          "@type": "Question",
          name: faq(`items.${k}.q`),
          acceptedAnswer: { "@type": "Answer", text: faq(`items.${k}.a`) },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output with "<" escaped, so the text can't close the script tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</g, "\\u003c"),
      }}
    />
  );
}
