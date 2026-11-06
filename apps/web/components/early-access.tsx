import { useTranslations } from "next-intl";

/** What works in early access today and what's next: keeps every claim on the page honest. */
export function EarlyAccess() {
  const t = useTranslations("earlyAccess");
  const now = t.raw("now") as string[];
  const soon = t.raw("soon") as string[];
  return (
    <section
      id="early-access"
      className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24 sm:px-8 sm:pb-32"
    >
      <div className="text-center">
        <h2 className="headline mx-auto max-w-[16ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>
      <div className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
        {[
          { title: t("nowTitle"), items: now, done: true },
          { title: t("soonTitle"), items: soon, done: false },
        ].map((col) => (
          <div key={col.title} className="border-t-2 border-ink pt-6">
            <h3 className="headline text-[1.75rem]">{col.title}</h3>
            <ul className="mt-5 grid gap-3.5">
              {col.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 text-[1.0625rem] leading-snug font-medium"
                >
                  {col.done ? (
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden
                      className="mt-1 size-4 shrink-0 text-[#1e8e3e]"
                    >
                      <path
                        d="M3 8.5 6.5 12 13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span
                      aria-hidden
                      className="mt-2 size-2 shrink-0 rounded-full border-2 border-ink/40"
                    />
                  )}
                  <span className={col.done ? "" : "text-ink/70"}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
