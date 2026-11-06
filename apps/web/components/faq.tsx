import { useTranslations } from "next-intl";

export const FAQ_KEYS = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
] as const;

/** Visible FAQ (native <details>, readable without JS); the same text feeds the page's FAQPage JSON-LD. */
export function Faq({
  ns = "faq",
  keys = FAQ_KEYS,
}: {
  ns?: "faq" | "glp1.faq";
  keys?: readonly string[];
}) {
  const t = useTranslations(ns);
  return (
    <section
      id="faq"
      className="mx-auto max-w-4xl scroll-mt-20 px-5 pb-24 sm:px-8 sm:pb-32"
    >
      <h2 className="headline text-center text-[clamp(2.5rem,5.5vw,4.75rem)]">
        {t("title")}
      </h2>
      <div className="faq mt-12 border-b border-line">
        {keys.map((k) => (
          <details key={k} name="faq" className="group border-t border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left text-[clamp(1.125rem,1.6vw,1.375rem)] font-semibold [&::-webkit-details-marker]:hidden">
              {t(`items.${k}.q` as never)}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="size-6 shrink-0 transition-transform duration-300 ease-[var(--ease-out-soft)] group-open:rotate-45"
              >
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </summary>
            <p className="max-w-3xl pb-7 text-[1.0625rem] leading-relaxed text-graphite">
              {t(`items.${k}.a` as never)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
