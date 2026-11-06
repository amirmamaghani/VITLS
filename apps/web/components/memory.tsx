import { useTranslations } from "next-intl";

const facts = ["shoulder", "smoking", "race", "food", "schedule"] as const;

export function Memory() {
  const t = useTranslations("memory");
  return (
    <section className="px-3 sm:px-4">
      <div className="stage mx-auto grid max-w-[90rem] items-center gap-12 bg-mist lg:grid-cols-2">
        <div>
          <h2 className="headline max-w-[14ch] text-[clamp(2.5rem,5vw,4.5rem)]">
            {t("title")}
          </h2>
          <p className="lead mt-5">{t("lead")}</p>
          <ul className="mt-9 flex flex-wrap gap-2">
            {facts.map((f) => (
              <li
                key={f}
                className="rounded-full bg-paper px-4 py-2.5 text-[0.9375rem] font-medium shadow-[0_1px_2px_rgba(32,33,36,0.08)]"
              >
                {t(`facts.${f}`)}
              </li>
            ))}
          </ul>
        </div>
        <blockquote className="relative rounded-[var(--radius-tile)] rounded-bl-md bg-paper p-8 text-[clamp(1.375rem,2.4vw,2rem)] leading-snug font-semibold shadow-[0_30px_60px_-30px_rgba(32,33,36,0.25)] sm:p-10">
          {t("quote")}
        </blockquote>
      </div>
    </section>
  );
}
