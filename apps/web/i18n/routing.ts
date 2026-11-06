import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "sk", "cs", "es", "it", "ru"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

export const localeNames: Record<Locale, string> = {
  en: "English",
  sk: "Slovenčina",
  cs: "Čeština",
  es: "Español",
  it: "Italiano",
  ru: "Русский",
};
