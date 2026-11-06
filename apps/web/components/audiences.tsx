"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { CountdownRing, useCycle } from "./autoplay";
import { Answer, Bubble } from "./chat";

const audiences = [
  { key: "gym", tint: "bg-peach" },
  { key: "longevity", tint: "bg-lilac" },
  { key: "biohacker", tint: "bg-sky" },
  { key: "everyday", tint: "bg-sage" },
  { key: "glp1", tint: "bg-butter" },
] as const;

const keys = audiences.map((a) => a.key);

/** Who VITLS is for: the same agent answers each audience's kind of question, cycling on its own. */
export function Audiences() {
  const t = useTranslations("audiences");
  const live = useTranslations("live");
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
  } = useCycle(keys);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const chat = useRef<HTMLDivElement>(null);

  // On every switch the question pops in, then the coach's reply writes itself.
  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Wait (hidden) until the section is first on screen, then reveal.
      if (!seen) {
        gsap.set(["[data-ask]", "[data-answer-label]", "[data-answer-text]"], {
          autoAlpha: 0,
        });
        return;
      }
      const reply = SplitText.create("[data-answer-text]", { type: "words" });
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from("[data-ask]", { autoAlpha: 0, y: 20, duration: 0.5 })
        .from(
          "[data-answer-label]",
          { autoAlpha: 0, y: 12, duration: 0.4 },
          "+=0.2",
        )
        .from(
          reply.words,
          { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.03 },
          "-=0.1",
        );
    },
    { scope: chat, dependencies: [active, seen], revertOnUpdate: true },
  );

  return (
    <section
      ref={watch}
      id="audiences"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 py-24 sm:px-4 sm:py-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[14ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>

      <div
        {...holdProps}
        className="mx-auto mt-14 grid max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12"
      >
        <div
          role="tablist"
          aria-label={t("title")}
          aria-orientation="vertical"
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
        >
          {audiences.map((a, i) => {
            const on = a.key === active;
            return (
              <button
                key={a.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                id={`audience-${a.key}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="audience-chat"
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(a.key)}
                onKeyDown={(e) => {
                  const next = onArrowKey(e, i);
                  if (next !== null) tabs.current[next]?.focus();
                }}
                className="group rounded-[var(--radius-tile)] px-2 py-4 text-left"
              >
                <span
                  className={`headline block text-[clamp(1.75rem,3vw,2.75rem)] transition-colors duration-300 ${on ? "" : "text-ink/25 group-hover:text-ink/50"}`}
                >
                  {t(`${a.key}.name`)}
                  {on && autoplay && (
                    <CountdownRing
                      key={active}
                      running={running}
                      onDone={advance}
                      className="ml-3 inline-block align-middle"
                    />
                  )}
                </span>
                <span
                  className={`mt-1.5 block text-[0.9375rem] leading-snug ${on ? "text-graphite" : "sr-only"}`}
                >
                  {t(`${a.key}.line`)}
                </span>
              </button>
            );
          })}
        </div>

        <div
          ref={chat}
          id="audience-chat"
          role="tabpanel"
          aria-labelledby={`audience-${active}`}
          className={`stage flex min-h-[26rem] flex-col justify-center gap-5 transition-colors duration-500 ${audiences.find((a) => a.key === active)!.tint}`}
        >
          <Bubble from="user" key={`q-${active}`} data-ask>
            {t(`${active}.ask`)}
          </Bubble>
          <Answer key={`a-${active}`} name={live("coach")}>
            {t(`${active}.reply`)}
          </Answer>
        </div>
      </div>
    </section>
  );
}
