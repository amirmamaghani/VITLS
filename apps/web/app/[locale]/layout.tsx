import type { Metadata, Viewport } from "next";
import { Google_Sans, Google_Sans_Flex } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/app-url";
import "../globals.css";

const flex = Google_Sans_Flex({
  subsets: ["latin", "latin-ext"],
  weight: "variable",
  axes: ["ROND"],
  variable: "--font-flex",
  adjustFontFallback: false,
});

// Google Sans Flex has no Cyrillic yet; Google Sans covers it (up to 700).
const cyrillic = Google_Sans({
  subsets: ["cyrillic", "cyrillic-ext"],
  weight: "variable",
  variable: "--font-cyrillic",
  adjustFontFallback: false,
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Open Graph locale codes for each site locale.
const ogLocales: Record<string, string> = {
  en: "en_US",
  sk: "sk_SK",
  cs: "cs_CZ",
  es: "es_ES",
  it: "it_IT",
  ru: "ru_RU",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const url = `/${locale}`;
  return {
    metadataBase: new URL(siteUrl),
    title: t("title"),
    description: t("description"),
    keywords: t("keywords").split(", "),
    applicationName: "VITLS",
    category: "health",
    creator: "VITLS",
    publisher: "VITLS",
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": `/${routing.defaultLocale}`,
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: "VITLS",
      title: t("ogTitle"),
      description: t("ogDescription"),
      locale: ogLocales[locale],
      alternateLocale: routing.locales
        .filter((l) => l !== locale)
        .map((l) => ogLocales[l]),
    },
    twitter: {
      card: "summary_large_image",
      title: t("ogTitle"),
      description: t("ogDescription"),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className={`${flex.variable} ${cyrillic.variable}`}
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
