"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { GithubButton } from "./github-button";
import { LanguageSwitcher } from "./language-switcher";
import { LiquidGlass } from "./liquid-glass";

// Section anchors on the home page.
const sections = ["live", "audiences", "coaches"] as const;

// Hysteresis: shrink past COMPACT_AT, expand again only above EXPAND_AT.
const COMPACT_AT = 80;
const EXPAND_AT = 16;

/**
 * At the very top the bar spans the page, flat and shadowless; once the page scrolls it
 * eases into the floating liquid-glass pill.
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCompact((was) => (was ? scrollY > EXPAND_AT : scrollY > COMPACT_AT));
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center">
      {/* One element: the glass bar itself animates width, height, offset, corners and shadow,
          with the same ease-out (easeOutCubic) in both directions. */}
      <LiquidGlass
        tint={0.7}
        className={`transition-[margin,height,width,border-radius,box-shadow] duration-600 ease-[cubic-bezier(0.33,1,0.68,1)] ${
          compact
            ? "mt-3 h-14 w-[min(calc(100%-1.5rem),56rem)] rounded-[28px] shadow-[0_18px_40px_-12px_rgba(32,33,36,0.28)]"
            : "mt-0 h-16 w-full rounded-none shadow-[0_0_0_0_rgba(32,33,36,0)]"
        }`}
      >
        <div className="mx-auto flex h-full max-w-[90rem] items-center gap-1 pr-2 pl-5 sm:pr-3 sm:pl-6">
          <Link
            href="/"
            aria-label={t("home")}
            className="headline mr-auto text-xl tracking-tight"
          >
            VITLS
          </Link>
          <nav className="hidden items-center lg:flex">
            {sections.map((s) => (
              <Link
                key={s}
                href={`/#${s}`}
                className="rounded-full px-3.5 py-2 text-[0.9375rem] font-medium whitespace-nowrap text-graphite hover:bg-black/5 hover:text-ink"
              >
                {t(s)}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher />
          <GithubButton className="pill pill-ink min-h-10 px-4 text-sm whitespace-nowrap">
            {t("cta")}
          </GithubButton>
        </div>
      </LiquidGlass>
    </header>
  );
}
