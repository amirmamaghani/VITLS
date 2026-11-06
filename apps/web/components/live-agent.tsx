"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { Answer, Bubble } from "./chat";

/**
 * The agent in action, inside the hero stage: the coach sends the morning readout,
 * the user asks, the coach types and answers with the user's own numbers.
 * Plays once after the hero intro; every message rises into place.
 */
export function LiveAgent() {
  const t = useTranslations("live");
  const hero = useTranslations("hero");
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const words = SplitText.create("[data-answer-text]", {
          type: "words",
        }).words;
        gsap
          .timeline({
            scrollTrigger: {
              trigger: root.current,
              start: "top 65%", // when the conversation itself is on screen
              once: true,
            },
            delay: 0.3,
            defaults: { ease: "power3.out" },
          })
          .from("[data-readout]", { autoAlpha: 0, y: 24, duration: 0.6 })
          .from("[data-ask]", { autoAlpha: 0, y: 24, duration: 0.6 }, "+=0.6")
          .from(
            "[data-answer-label]",
            { autoAlpha: 0, y: 12, duration: 0.4 },
            "+=0.4",
          )
          .from(
            words,
            { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.035 },
            "+=1.6",
          )
          // Typing dots fill the pause before the words, in the words' place.
          .to("[data-typing]", { autoAlpha: 1, duration: 0.2 }, "<-1.5")
          .to(
            "[data-typing] span",
            {
              y: -5,
              duration: 0.22,
              stagger: 0.1,
              repeat: 5,
              yoyo: true,
              ease: "sine.inOut",
            },
            "<",
          )
          .to("[data-typing]", { autoAlpha: 0, duration: 0.15 }, "<1.3");
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="flex flex-col gap-5 text-left">
      <Bubble from="coach" data-readout>
        {hero("bubble")}
      </Bubble>
      <Bubble from="user" data-ask>
        {t("ask")}
      </Bubble>
      <Answer name={t("coach")} status={t("synced")} typing>
        {t("answer")}
      </Answer>
    </div>
  );
}
