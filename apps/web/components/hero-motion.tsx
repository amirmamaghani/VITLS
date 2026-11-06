"use client";

import { useRef, type ReactNode } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

/** The page's load moment: headline rises out of its lines, the stage settles (the conversation follows in LiveAgent). */
export function HeroMotion({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        SplitText.create("[data-hero-title]", {
          type: "lines,words",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) => {
            // The line masks clip at the tight 0.95 line-height; give descenders (y, g, j)
            // and accents (č, ý) room without changing the line breaks.
            gsap.set(self.masks, {
              paddingBlock: "0.15em",
              marginBlock: "-0.15em",
            });
            return (
              gsap
                .timeline({ defaults: { ease: "expo.out" } })
                .from(self.words, {
                  yPercent: 110,
                  duration: 1.1,
                  stagger: 0.06,
                })
                .from(
                  "[data-hero-fade]",
                  { y: 24, autoAlpha: 0, duration: 0.9, stagger: 0.08 },
                  0.35,
                )
                .from(
                  "[data-hero-stage]",
                  { y: 80, scale: 0.94, duration: 1.3 },
                  0.3,
                )
                .from(
                  "[data-runner]",
                  {
                    autoAlpha: 0,
                    y: 60,
                    scale: 0.85,
                    duration: 1.2,
                    ease: "back.out(1.4)",
                  },
                  0.6,
                )
                // Then the runner keeps a gentle stride bounce.
                .to("[data-runner]", {
                  y: -14,
                  duration: 0.9,
                  ease: "sine.inOut",
                  yoyo: true,
                  repeat: -1,
                })
            );
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className={className}>
      {children}
    </section>
  );
}
