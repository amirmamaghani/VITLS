"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

// Wordmarks in public/logos, drawn as one-colour masks; ratio = viewBox width / height.
const GROUPS = [
  {
    key: "watches",
    logos: [
      { slug: "garmin", name: "Garmin", ratio: 3.61, weight: 1.2 },
      { slug: "polar", name: "Polar", ratio: 5.85, weight: 0.98 },
      { slug: "suunto", name: "Suunto", ratio: 3.02, weight: 1.2 },
      { slug: "samsung", name: "Samsung", ratio: 6.32, weight: 0.95 },
    ],
  },
  {
    key: "rings",
    logos: [
      { slug: "oura", name: "Oura", ratio: 3.13, weight: 1.08 },
      { slug: "whoop", name: "WHOOP", ratio: 6.15, weight: 1.1 },
      { slug: "fitbit", name: "Fitbit", ratio: 3.91, weight: 1.0 },
    ],
  },
  {
    key: "more",
    logos: [
      { slug: "withings", name: "Withings", ratio: 5.23, weight: 1.02 },
      { slug: "strava", name: "Strava", ratio: 4.61, weight: 0.95 },
    ],
  },
] as const;

const PLATFORMS = ["apple", "android"] as const;

/**
 * Supported devices. Everything arrives through Apple Health or Health Connect via the
 * companion app (no vendor APIs), so the logos are examples of what syncs there.
 */
export function Devices() {
  const t = useTranslations("devices");
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-tile]", {
          autoAlpha: 0,
          y: 24,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.05,
          scrollTrigger: {
            trigger: root.current,
            start: "top 70%",
            once: true,
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      id="devices"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 py-24 sm:px-4 sm:py-32"
    >
      <div className="px-2 text-center">
        <p className="mb-8 inline-flex items-center gap-2 rounded-full bg-mist px-4 py-2 text-[0.9375rem] font-semibold">
          <span className="size-2 rounded-full bg-ink" />
          {t("status")}
        </p>
        <h2 className="headline mx-auto max-w-[16ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5 max-w-2xl">{t("lead")}</p>
        <ul className="mt-9 flex flex-wrap justify-center gap-3">
          {PLATFORMS.map((p) => (
            <li
              key={p}
              className="inline-flex items-baseline gap-2 rounded-full bg-ink px-6 py-3 text-paper"
            >
              <span className="headline text-xl">
                {t(`platforms.${p}.name`)}
              </span>
              <span className="text-[0.9375rem] font-medium text-paper/70">
                {t(`platforms.${p}.os`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* One flat stage: a row per category, label on the left, wordmarks on a fixed grid. */}
      <div className="mt-14 rounded-[var(--radius-stage)] bg-mist px-6 py-2 sm:px-10 lg:px-14">
        {GROUPS.map((g) => (
          <div
            key={g.key}
            className="grid items-center gap-6 border-b border-line py-8 sm:py-10 lg:grid-cols-[15rem_1fr] lg:gap-10"
          >
            <h3 className="headline text-center text-[clamp(1.375rem,1.8vw,1.75rem)] lg:text-left">
              {t(`groups.${g.key}`)}
            </h3>
            <ul className="flex flex-wrap justify-center gap-y-9 lg:justify-start">
              {g.logos.map((l) => (
                <li
                  key={l.slug}
                  data-tile
                  className="flex h-14 min-w-0 basis-1/2 items-center justify-center px-3 sm:basis-1/4"
                >
                  {/* Optical sizing: same visual area for every wordmark, nudged by stroke weight. */}
                  <span
                    role="img"
                    aria-label={l.name}
                    className="block max-w-full bg-ink"
                    style={{
                      height: `${((3.3 * l.weight) / Math.sqrt(l.ratio)).toFixed(2)}rem`,
                      aspectRatio: l.ratio,
                      mask: `url(/logos/${l.slug}.svg) center / contain no-repeat`,
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="py-8 text-center text-[1.0625rem] font-semibold text-graphite sm:py-10">
          {t("anyDevice")}
        </p>
      </div>

      <p className="mx-auto mt-8 max-w-3xl px-2 text-center text-sm text-graphite">
        {t("note")}
      </p>
    </section>
  );
}
