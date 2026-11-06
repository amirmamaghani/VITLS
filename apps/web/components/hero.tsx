import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { appUrl } from "@/lib/app-url";
import { ClayImage } from "./clay-image";
import { HeroMotion } from "./hero-motion";
import { LiveAgent } from "./live-agent";

export function Hero() {
  const t = useTranslations("hero");
  const live = useTranslations("live");
  const glp1 = useTranslations("glp1");
  const [leadFirst, ...leadRest] = t("lead").split(/(?<=\.)\s+/);
  return (
    <HeroMotion className="px-3 pt-32 pb-24 text-center sm:px-4 sm:pt-40 sm:pb-32">
      {/* Announcement chip: the GLP-1 landing page. */}
      <Link
        href="/glp1"
        data-hero-fade
        className="mb-8 inline-flex items-center gap-2 rounded-full bg-peach px-4 py-2 text-[0.9375rem] font-semibold transition-colors hover:bg-[#ffd3bb]"
      >
        <span className="size-2 rounded-full bg-ink" />
        {glp1("chip")}
        <svg viewBox="0 0 16 16" aria-hidden className="size-4">
          <path
            d="M6 3.5 10.5 8 6 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
      <h1
        data-hero-title
        className="display mx-auto max-w-[14ch] text-[clamp(3.25rem,9.5vw,9rem)]"
      >
        {t("title")}
      </h1>
      {/* First sentence on its own line, the rest balanced underneath. */}
      <p
        data-hero-fade
        className="mx-auto mt-8 max-w-[44rem] text-[clamp(1.25rem,2vw,1.625rem)] leading-snug font-medium text-ink/80"
      >
        <span className="block font-semibold text-ink">{leadFirst}</span>
        <span className="mt-1 block text-balance">{leadRest.join(" ")}</span>
      </p>
      <div data-hero-fade className="mt-9 flex flex-wrap justify-center gap-3">
        <a href={appUrl} className="pill pill-ink">
          {t("cta")}
        </a>
        <a href="#live" className="pill pill-quiet">
          {t("secondary")}
        </a>
      </div>

      {/* The stage: the runner on one side, the coach conversation playing out on the other. */}
      <div
        id="live"
        data-hero-stage
        className="mx-auto mt-16 grid max-w-6xl scroll-mt-24 items-center gap-6 rounded-[var(--radius-stage)] bg-sky p-5 sm:p-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10 lg:p-12"
      >
        <div data-runner className="mx-auto w-full max-w-md lg:max-w-none">
          <ClayImage
            slot="hero"
            alt={t("imageAlt")}
            priority
            feather={false}
            sizes="(min-width: 1024px) 520px, 90vw"
            className="aspect-square"
          />
        </div>
        <LiveAgent />
      </div>
      <p data-hero-fade className="mt-8 text-[0.9375rem] text-graphite">
        {live("sources")}
      </p>
    </HeroMotion>
  );
}
