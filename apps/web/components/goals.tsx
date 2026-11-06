"use client";

import { useLocale, useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { Flip, gsap } from "@/lib/gsap";

type Goal =
  | "fatLoss"
  | "running"
  | "strength"
  | "swimming"
  | "cardio"
  | "longevity";
type Widget =
  | "weightTrend"
  | "protein"
  | "deficit"
  | "easyPace"
  | "weeklyDistance"
  | "vo2max"
  | "records"
  | "sets"
  | "swolf"
  | "swimDistance"
  | "hrv"
  | "sleep"
  | "restingHr";

const goals: Record<Goal, Widget[]> = {
  fatLoss: ["weightTrend", "protein", "deficit"],
  running: ["easyPace", "weeklyDistance", "vo2max"],
  strength: ["records", "sets", "protein"],
  swimming: ["swimDistance", "swolf"],
  cardio: ["vo2max", "restingHr", "weeklyDistance"],
  longevity: ["hrv", "sleep", "restingHr"],
};

// Sample readings: value, unit, decimals, and a 7-point trend for the sparkline.
const samples: Record<Widget, [number, string, number, number[]]> = {
  weightTrend: [82.4, "kg", 1, [84, 83.8, 83.5, 83.6, 83.1, 82.8, 82.4]],
  protein: [148, "g", 0, [120, 135, 150, 142, 160, 138, 148]],
  deficit: [3450, "kcal", 0, [300, 520, 410, 600, 480, 560, 580]],
  easyPace: [342, "/km", 0, [-366, -360, -355, -354, -350, -347, -342]],
  weeklyDistance: [32, "km", 0, [18, 22, 25, 21, 28, 30, 32]],
  vo2max: [49, "ml/kg/min", 0, [46, 46, 47, 47, 48, 48, 49]],
  records: [3, "PR", 0, [0, 1, 1, 1, 2, 2, 3]],
  sets: [64, "", 0, [40, 48, 52, 56, 58, 60, 64]],
  swolf: [38, "", 0, [44, 43, 42, 41, 40, 39, 38]],
  swimDistance: [4.2, "km", 1, [2, 2.6, 3, 3.1, 3.6, 3.9, 4.2]],
  hrv: [58, "ms", 0, [52, 49, 55, 57, 54, 60, 58]],
  sleep: [7.4, "h", 1, [6.5, 7.1, 6.8, 7.6, 7.2, 7.9, 7.4]],
  restingHr: [52, "bpm", 0, [56, 55, 55, 54, 53, 53, 52]],
};

const tints = ["bg-sky", "bg-peach", "bg-lilac", "bg-butter", "bg-sage"];
const tintOf = (w: Widget) =>
  tints[Object.keys(samples).indexOf(w) % tints.length];

/** Pace is stored in seconds and shown as m:ss. */
const formatValue = (
  value: number,
  unit: string,
  digits: number,
  locale: string,
) =>
  unit === "/km"
    ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`
    : value.toLocaleString(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

function sparkline(points: number[]) {
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  return points
    .map(
      (p, i) =>
        `${(i / (points.length - 1)) * 100},${28 - ((p - min) / span) * 24}`,
    )
    .join(" ");
}

export function Goals() {
  const t = useTranslations("goals");
  const locale = useLocale();
  const [picked, setPicked] = useState<Goal[]>(["fatLoss", "longevity"]);
  const grid = useRef<HTMLUListElement>(null);
  const flip = useRef<Flip.FlipState | null>(null);

  const widgets = [...new Set(picked.flatMap((g) => goals[g]))];

  const toggle = (goal: Goal) => {
    flip.current = Flip.getState(grid.current!.children);
    setPicked((p) =>
      p.includes(goal) ? p.filter((g) => g !== goal) : [...p, goal],
    );
  };

  useLayoutEffect(() => {
    if (!flip.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = Flip.from(flip.current, {
      duration: reduced ? 0 : 0.6,
      ease: "power3.inOut",
      stagger: 0.02,
      onEnter: (els) =>
        gsap.fromTo(
          els,
          { autoAlpha: 0, scale: 0.85 },
          {
            autoAlpha: 1,
            scale: 1,
            duration: reduced ? 0 : 0.5,
            delay: 0.15,
            ease: "back.out(1.4)",
          },
        ),
    });
    flip.current = null;
    return () => {
      tween.kill();
    };
  }, [picked]);

  return (
    <section
      id="goals"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 py-24 sm:px-4 sm:py-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[15ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>

      <fieldset className="mt-12">
        <legend className="sr-only">{t("hint")}</legend>
        <div className="flex flex-wrap justify-center gap-2">
          {(Object.keys(goals) as Goal[]).map((g) => {
            const on = picked.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g)}
                className={`pill text-[0.9375rem] ${on ? "pill-ink" : "pill-quiet"}`}
              >
                {t(`options.${g}`)}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-center text-sm text-graphite">{t("hint")}</p>
      </fieldset>

      <ul
        ref={grid}
        aria-live="polite"
        className="mx-auto mt-10 grid min-h-48 max-w-5xl grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3"
      >
        {widgets.map((w) => {
          const [value, unit, digits, trend] = samples[w];
          return (
            <li
              key={w}
              data-flip-id={w}
              className={`flex flex-col justify-between rounded-[var(--radius-tile)] p-5 sm:p-6 ${tintOf(w)}`}
            >
              <span className="text-sm font-semibold text-ink/70">
                {t(`widgets.${w}`)}
              </span>
              <span className="mt-3 flex items-baseline gap-1.5">
                <span className="headline text-[clamp(1.75rem,3.5vw,2.75rem)] tabular-nums">
                  {formatValue(value, unit, digits, locale)}
                </span>
                <span className="text-sm font-semibold text-ink/60">
                  {unit}
                </span>
              </span>
              <svg
                viewBox="0 0 100 30"
                preserveAspectRatio="none"
                aria-hidden
                className="mt-4 h-8 w-full overflow-visible"
              >
                <polyline
                  points={sparkline(trend)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
