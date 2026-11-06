"use client";

import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { CountdownRing, useCycle } from "./autoplay";
import { Answer } from "./chat";

export type Persona = "strict" | "scientist" | "supportive" | "longevity";

const tints: Record<Persona, string> = {
  strict: "bg-peach",
  scientist: "bg-sky",
  supportive: "bg-sage",
  longevity: "bg-lilac",
};

/** The four coaching styles, cycling on their own: each answers the same short night in its own voice. */
export function CoachPicker({
  personas,
  avatars,
}: {
  personas: Persona[];
  avatars: Record<string, ReactNode>;
}) {
  const t = useTranslations("coaches");
  const {
    active,
    setActive,
    autoplay,
    running,
    seen,
    advance,
    watch,
    holdProps,
    onArrowKey,
  } = useCycle(personas);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const reply = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Wait (hidden) until the section is first on screen, then reveal.
      if (!seen) {
        gsap.set(["[data-answer-label]", "[data-answer-text]"], {
          autoAlpha: 0,
        });
        return;
      }
      const words = SplitText.create("[data-answer-text]", { type: "words" });
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from("[data-answer-label]", { autoAlpha: 0, y: 12, duration: 0.4 })
        .from(
          words.words,
          { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.03 },
          "-=0.1",
        );
    },
    { scope: reply, dependencies: [active, seen], revertOnUpdate: true },
  );

  return (
    <div ref={watch} {...holdProps} className="mt-14">
      <div
        role="tablist"
        aria-label={t("title")}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {personas.map((p, i) => {
          const on = p === active;
          return (
            <button
              key={p}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`coach-${p}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="coach-reply"
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(p)}
              onKeyDown={(e) => {
                const next = onArrowKey(e, i);
                if (next !== null) tabs.current[next]?.focus();
              }}
              className={`group flex flex-col overflow-hidden rounded-[var(--radius-tile)] text-left ring-ink transition-[box-shadow,opacity] duration-300 ${tints[p]} ${on ? "ring-3" : "ring-0 opacity-70 hover:opacity-100"}`}
            >
              <div className="transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]">
                {avatars[p]}
              </div>
              <span className="px-5 pb-5 sm:px-6 sm:pb-6">
                <span className="headline flex items-center gap-2 text-[clamp(1.375rem,2vw,1.75rem)]">
                  {t(`${p}.name`)}
                  {on && autoplay && (
                    <CountdownRing
                      key={active}
                      running={running}
                      onDone={advance}
                      className="shrink-0"
                    />
                  )}
                </span>
                <span className="mt-1.5 block text-[0.9375rem] leading-snug text-ink/70">
                  {t(`${p}.line`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={reply}
        id="coach-reply"
        role="tabpanel"
        aria-labelledby={`coach-${active}`}
        className="stage mx-auto mt-8 flex max-w-4xl flex-col gap-5 bg-mist"
      >
        <p className="text-sm font-semibold text-graphite">{t("scenario")}</p>
        <Answer key={active} name={t(`${active}.name`)}>
          {t(`${active}.sample`)}
        </Answer>
      </div>
    </div>
  );
}
