"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, routing, type Locale } from "@/i18n/routing";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(e) =>
          router.replace(pathname, { locale: e.target.value as Locale })
        }
        className="h-10 cursor-pointer appearance-none rounded-full bg-transparent py-0 pr-8 pl-3 text-sm font-semibold hover:bg-black/5"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {localeNames[l]}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 size-3"
      >
        <path
          d="M2 4.5 6 8l4-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    </label>
  );
}
