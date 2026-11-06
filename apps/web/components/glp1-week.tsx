"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

// Sample injection week: protein (g) and nausea (0–4) by day since the shot (day 0).
const FLOOR = 110;
const DAYS = [
  { protein: 96, nausea: 1 },
  { protein: 58, nausea: 3 },
  { protein: 72, nausea: 2 },
  { protein: 104, nausea: 1 },
  { protein: 118, nausea: 0 },
  { protein: 126, nausea: 0 },
  { protein: 121, nausea: 0 },
];
const MAX = 140;

/**
 * The relationship the coach watches: intake dips on the days after the injection.
 * Bars rise toward the protein floor (dashed, in the card colour); days under it stay light.
 */
export function Glp1Week({ image }: { image?: ReactNode }) {
  const t = useTranslations("glp1.week");
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: root.current,
              start: "top 75%",
              once: true,
            },
            defaults: { ease: "power3.out" },
          })
          .from("[data-bar]", {
            scaleY: 0,
            transformOrigin: "50% 100%",
            duration: 0.9,
            stagger: 0.07,
          })
          .from(
            "[data-dot]",
            { scale: 0, duration: 0.4, stagger: 0.05 },
            "-=0.5",
          );
      });
    },
    { scope: root },
  );

  return (
    <div
      ref={root}
      className="stage bg-[var(--card)] text-center"
      style={{ ["--card" as string]: "var(--color-lilac)" }}
    >
      <h3 className="headline text-[clamp(1.75rem,3vw,2.75rem)]">
        {t("title")}
      </h3>
      <p className="mx-auto mt-3 max-w-xl text-[clamp(1.0625rem,1.5vw,1.25rem)] font-semibold text-ink/75">
        {t("lead")}
      </p>

      {/* Server-rendered illustration (ClayImage reads the file on the server). */}
      {image}

      <p
        className={`${image ? "mt-4" : "mt-8"} inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 font-semibold shadow-[0_1px_2px_rgba(32,33,36,0.06)]`}
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0">
          <circle
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle
            cx="8"
            cy="8"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
        </svg>
        {t("floor")}{" "}
        <span className="headline tabular-nums">{FLOOR}&nbsp;g</span>
      </p>

      <div className="mx-auto mt-6 max-w-2xl" aria-hidden>
        <div className="relative flex h-56 items-end gap-2 sm:gap-3">
          {DAYS.map((d, i) => (
            <span
              key={i}
              data-bar
              className={`flex-1 rounded-t-2xl ${d.protein >= FLOOR ? "bg-ink" : "bg-ink/20"}`}
              style={{ height: `${(d.protein / MAX) * 100}%` }}
            />
          ))}
          <span
            className="absolute inset-x-0 border-t-2 border-dashed border-[var(--card)]"
            style={{ bottom: `${(FLOOR / MAX) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex gap-2 sm:gap-3">
          {DAYS.map((d, i) => (
            <span key={i} className="flex flex-1 flex-col items-center gap-2">
              <span
                className={`text-sm tabular-nums ${i === 0 ? "font-bold" : "text-ink/60"}`}
              >
                {i === 0 ? t("shot") : `+${i}`}
              </span>
              <span
                data-dot
                className="rounded-full bg-ink"
                style={{
                  width: 6 + d.nausea * 4,
                  height: 6 + d.nausea * 4,
                  opacity: d.nausea ? 1 : 0.15,
                }}
              />
            </span>
          ))}
        </div>
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-ink/60">
          <span className="size-2.5 rounded-full bg-ink" />
          {t("nausea")}
        </p>
      </div>
      <p className="sr-only">{t("summary")}</p>
    </div>
  );
}
