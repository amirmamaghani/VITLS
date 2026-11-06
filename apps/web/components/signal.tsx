"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

const GAIN = 2.1;
const parts = [
  { key: "water", kg: 1.4, color: "bg-sky" },
  { key: "glycogen", kg: 0.5, color: "bg-butter" },
  { key: "transit", kg: 0.2, color: "bg-peach" },
  { key: "fat", kg: 0, color: "bg-sage" },
] as const;

/** The scroll-scrubbed reframe: a scary overnight jump, decomposed until fat reads 0.0. */
export function Signal() {
  const t = useTranslations("signal");
  const locale = useLocale();
  const kg = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const root = useRef<HTMLElement>(null);
  const number = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          pinned:
            "(prefers-reduced-motion: no-preference) and (min-width: 768px) and (min-height: 640px)",
          flowing:
            "(prefers-reduced-motion: no-preference) and ((max-width: 767px) or (max-height: 639px))",
        },
        (ctx) => {
          const { pinned } = ctx.conditions!;
          const counter = { v: 0 };
          const show = () =>
            (number.current!.textContent = `+${kg.format(counter.v)}`);
          show();

          gsap
            .timeline({
              defaults: { ease: "power2.out" },
              scrollTrigger: pinned
                ? {
                    trigger: root.current,
                    start: "top top",
                    end: "+=220%",
                    pin: true,
                    scrub: 0.6,
                  }
                : {
                    trigger: root.current,
                    start: "top 75%",
                    end: "bottom 85%",
                    scrub: 0.6,
                  },
            })
            .to(counter, { v: GAIN, duration: 1.4, onUpdate: show })
            .from("[data-bar]", {
              scaleX: 0,
              transformOrigin: "left center",
              duration: 0.5,
              stagger: 0.35,
            })
            .from(
              "[data-part]",
              { autoAlpha: 0, y: 14, duration: 0.5, stagger: 0.35 },
              "<",
            )
            .from("[data-coach]", { autoAlpha: 0, y: 48, duration: 0.9 })
            .to({}, { duration: 0.6 });

          return () => {
            counter.v = GAIN;
            show();
          };
        },
      );
    },
    { scope: root },
  );

  return (
    <section
      id="signal"
      ref={root}
      className="px-3 py-3 sm:px-4 md:h-svh md:min-h-[640px] md:pt-20"
    >
      <div className="stage mx-auto flex h-full max-w-[90rem] flex-col justify-center gap-10 bg-ink text-white lg:flex-row lg:items-center lg:gap-16">
        <div className="min-w-0 flex-1">
          <h2 className="headline text-[clamp(2.5rem,5vw,4.5rem)]">
            {t("title")}
          </h2>
          <p className="lead mt-4 text-[#bdc1c6]">{t("lead")}</p>

          <p className="mt-8 flex items-baseline gap-3">
            <span
              ref={number}
              className="display text-[clamp(5.5rem,17vw,15rem)] tabular-nums"
            >
              +{kg.format(GAIN)}
            </span>
            <span className="headline text-[clamp(1.75rem,4vw,3.5rem)]">
              kg
            </span>
          </p>
          <p className="text-lg text-[#bdc1c6]">{t("reading")}</p>

          <div className="mt-8 flex h-3 gap-1 overflow-hidden rounded-full">
            {parts.map((p) =>
              p.kg ? (
                <span
                  key={p.key}
                  data-bar
                  className={`${p.color} rounded-full`}
                  style={{ flexGrow: p.kg }}
                />
              ) : null,
            )}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {parts.map((p) => (
              <div key={p.key} data-part>
                <dt className="flex items-center gap-2 text-sm text-[#bdc1c6]">
                  <span className={`size-2.5 rounded-full ${p.color}`} />
                  {t(p.key)}
                </dt>
                <dd
                  className={
                    p.kg
                      ? "mt-0.5 text-xl font-bold tabular-nums"
                      : "headline mt-0.5 text-3xl text-sage tabular-nums"
                  }
                >
                  {kg.format(p.kg)} kg
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <figure
          data-coach
          className="rounded-[var(--radius-tile)] bg-white/[0.08] p-6 sm:p-8 lg:max-w-md"
        >
          <span className="text-sm font-semibold text-[#8ab4f8]">
            {t("coachLabel")}
          </span>
          <blockquote className="mt-2 text-[clamp(1.25rem,2vw,1.625rem)] leading-snug font-semibold">
            {t("coach")}
          </blockquote>
        </figure>
      </div>
    </section>
  );
}
