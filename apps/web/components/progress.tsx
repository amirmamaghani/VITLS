"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

/*
 * Each goal gets the chart its meaning calls for:
 * - fat loss: monthly weigh-ins stepping down to a goal line near the floor
 * - half marathon: race readiness as a ring, predicted finish counting down
 * - VO2max: a level meter filling up toward the goal notch
 * All sample values; motion is vertical or radial only.
 */
const WEIGHTS = [86.0, 84.6, 83.4, 82.3, 81.4, 80.8];
const WEIGHT_GOAL = 78;
const FINISH = { from: 125, now: 112, goal: 110, readiness: 0.85 }; // minutes
const VO2 = { axis: [40, 55], now: 47, goal: 50 };

const share = (v: number, [lo, hi]: number[]) => (v - lo) / (hi - lo);
const clock = (min: number) =>
  `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

type Count = { from: number; to: number; format: (v: number) => string };

export function Progress() {
  const t = useTranslations("progress");
  const locale = useLocale();
  const kg = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });
  const root = useRef<HTMLElement>(null);

  const counts: Record<string, Count> = {
    fat: {
      from: 0,
      to: -5.2,
      format: (v) => `${kg.format(v).replace("-", "\u2212")} kg`,
    },
    run: { from: FINISH.from, to: FINISH.now, format: clock },
    vo2: {
      from: VO2.axis[0],
      to: VO2.now,
      format: (v) => String(Math.round(v)),
    },
  };

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>("[data-goal]").forEach((card, i) => {
          const c = counts[card.dataset.goal!];
          const label = card.querySelector<HTMLElement>("[data-count]")!;
          const value = { v: c.from };
          label.textContent = c.format(c.from);
          const rise = card.querySelectorAll("[data-rise]");
          const ring = card.querySelectorAll("[data-ring]");
          const tl = gsap
            .timeline({
              scrollTrigger: { trigger: card, start: "top 75%", once: true },
              delay: i * 0.12,
              defaults: { ease: "power3.out" },
            })
            .to(
              value,
              {
                v: c.to,
                duration: 1.4,
                onUpdate: () => (label.textContent = c.format(value.v)),
              },
              0,
            );
          // Each card has either rising shapes or a ring.
          if (rise.length)
            tl.from(
              rise,
              {
                scaleY: 0,
                transformOrigin: "50% 100%",
                duration: 0.9,
                stagger: 0.08,
              },
              0,
            );
          if (ring.length)
            tl.from(
              ring,
              {
                strokeDashoffset: (_, el: SVGCircleElement) =>
                  el.getTotalLength(),
                duration: 1.4,
                ease: "power2.inOut",
              },
              0,
            );
          tl.from(
            card.querySelectorAll("[data-after]"),
            { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.1 },
            "-=0.4",
          );
        });
        // Reverted (e.g. reduced motion switched on): show the real numbers again.
        return () =>
          gsap.utils.toArray<HTMLElement>("[data-goal]").forEach((card) => {
            const c = counts[card.dataset.goal!];
            card.querySelector("[data-count]")!.textContent = c.format(c.to);
          });
      });
    },
    { scope: root },
  );

  const goals: Record<string, string> = {
    fat: `${WEIGHT_GOAL}\u00a0kg`,
    run: clock(FINISH.goal),
    vo2: String(VO2.goal),
  };
  const readiness = new Intl.NumberFormat(locale, { style: "percent" }).format(
    FINISH.readiness,
  );

  // Every chart sits left-aligned in the same box; the goal itself is the caption above.
  const charts: Record<string, ReactNode> = {
    // Bars stand on the goal line and show what is left to lose, shrinking toward it.
    fat: (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-end gap-2">
          {WEIGHTS.map((w, i) => (
            <span
              key={i}
              data-rise
              className={`flex-1 rounded-t-xl ${i === WEIGHTS.length - 1 ? "bg-ink" : "bg-ink/15"}`}
              style={{
                height: `${((w - WEIGHT_GOAL) / (WEIGHTS[0] - WEIGHT_GOAL)) * 100}%`,
              }}
            />
          ))}
        </div>
        <span className="relative z-10 -mt-0.5 border-t-2 border-dashed border-[var(--card)]" />
      </div>
    ),
    run: (
      <div className="relative mx-auto aspect-square h-full">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
          <circle
            cx="80"
            cy="80"
            r="68"
            fill="none"
            stroke="rgba(32,33,36,0.1)"
            strokeWidth="18"
          />
          <circle
            data-ring
            cx="80"
            cy="80"
            r="68"
            fill="none"
            stroke="#202124"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 68}
            strokeDashoffset={2 * Math.PI * 68 * (1 - FINISH.readiness)}
          />
        </svg>
        <span className="headline absolute inset-0 grid place-items-center text-2xl tabular-nums">
          {readiness}
        </span>
      </div>
    ),
    vo2: (
      <div className="flex h-full justify-center">
        <div className="relative w-14 overflow-hidden rounded-full bg-ink/10">
          <span
            data-rise
            className="absolute inset-x-0 bottom-0 rounded-full bg-ink"
            style={{ height: `${share(VO2.now, VO2.axis) * 100}%` }}
          />
          <span
            className="absolute inset-x-0 border-t-2 border-dashed border-[var(--card)]"
            style={{ bottom: `${share(VO2.goal, VO2.axis) * 100}%` }}
          />
        </div>
      </div>
    ),
  };

  return (
    <section
      ref={root}
      className="mx-auto max-w-[90rem] px-3 pb-24 sm:px-4 sm:pb-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[14ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>

      <div className="mt-14 grid gap-3 sm:gap-4 lg:grid-cols-3">
        {(["fat", "run", "vo2"] as const).map((key, i) => (
          <article
            key={key}
            data-goal={key}
            // Six rows shared across cards (subgrid) so every part lines up, top-aligned.
            // Dashed goal marks are drawn in the card colour, so they read as cuts, not extra lines.
            style={{
              ["--card" as string]: `var(--color-${["peach", "sky", "lilac"][i]})`,
            }}
            className="stage flex flex-col items-center bg-[var(--card)] text-center lg:row-span-6 lg:grid lg:grid-rows-subgrid lg:items-start lg:justify-items-center lg:gap-y-0"
          >
            <header>
              <h3 className="headline text-[clamp(1.5rem,2.2vw,2rem)] text-balance">
                {t(`${key}.name`)}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] text-ink/60">
                {t(`${key}.detail`)}
              </p>
            </header>
            <p
              data-count
              className="display mt-5 text-[clamp(3.5rem,6vw,5.5rem)] whitespace-nowrap tabular-nums"
            >
              {counts[key].format(counts[key].to)}
            </p>
            <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 font-semibold shadow-[0_1px_2px_rgba(32,33,36,0.06)]">
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
              {t("goalLine")}
              <span className="headline tabular-nums">{goals[key]}</span>
            </p>
            <div className="mt-3 h-40 w-full max-w-xs" aria-hidden>
              {charts[key]}
            </div>
            <p
              data-after
              className="mt-8 flex items-center justify-center gap-2 font-semibold"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0">
                <path
                  d={
                    key === "fat"
                      ? "M2.5 5 6.5 9l3-3 4 5.5"
                      : "M2.5 11 6.5 7l3 3 4-5.5"
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t(`${key}.eta`)}
            </p>
            <p
              data-after
              className="mt-3 max-w-xs text-[1.0625rem] leading-snug text-pretty text-ink/75"
            >
              {t(`${key}.note`)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
