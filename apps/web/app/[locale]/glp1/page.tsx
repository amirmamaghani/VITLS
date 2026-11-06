import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Answer, Bubble } from "@/components/chat";
import { ClayImage } from "@/components/clay-image";
import { Cta, SiteFooter } from "@/components/closing";
import { Faq } from "@/components/faq";
import { Glp1Week } from "@/components/glp1-week";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";
import { noBreak } from "@/lib/no-break";
import { appUrl, siteUrl } from "@/lib/app-url";

// Pictured features first (clay render on the card colour), then the text-only pair.
const PICTURED = [
  { key: "protein", slot: "glp1-hydration", bg: "bg-butter" },
  { key: "muscle", slot: "glp1-strength", bg: "bg-lilac" },
  { key: "doctor", slot: "glp1-log", bg: "bg-sky" },
] as const;
const PLAIN = ["rhythm", "symptoms"] as const;
const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/glp1">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "glp1",
  });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    keywords: t("keywords").split(", "),
    alternates: {
      canonical: `/${locale}/glp1`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}/glp1`])),
        "x-default": `/${routing.defaultLocale}/glp1`,
      },
    },
    openGraph: {
      type: "website",
      url: `/${locale}/glp1`,
      siteName: "VITLS",
      title: t("ogTitle"),
      description: t("ogDescription"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("ogTitle"),
      description: t("ogDescription"),
    },
  };
}

/** Landing page for people on GLP-1 medication: eat enough, keep the muscle, bring the data to the doctor. */
export default async function Glp1Page({
  params,
}: PageProps<"/[locale]/glp1">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("glp1");
  const live = await getTranslations("live");
  const page = `${siteUrl}/${locale}/glp1`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${page}#webpage`,
        url: page,
        name: t("metaTitle"),
        description: t("metaDescription"),
        inLanguage: locale,
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@id": `${siteUrl}/#app` },
        mainEntity: { "@id": `${page}#faq` },
      },
      {
        "@type": "FAQPage",
        "@id": `${page}#faq`,
        inLanguage: locale,
        mainEntity: FAQ_KEYS.map((k) => ({
          "@type": "Question",
          name: t(`faq.items.${k}.q`),
          acceptedAnswer: { "@type": "Answer", text: t(`faq.items.${k}.a`) },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader />
      <main>
        <section className="px-3 pt-32 pb-24 text-center sm:px-4 sm:pt-40 sm:pb-32">
          <p className="mb-8 inline-flex items-center gap-2 rounded-full bg-peach px-4 py-2 text-[0.9375rem] font-semibold">
            <span className="size-2 rounded-full bg-ink" />
            {t("status")}
          </p>
          <h1 className="display mx-auto max-w-[14ch] text-[clamp(3rem,8vw,7.5rem)]">
            {noBreak(t("title"))}
          </h1>
          <p className="mx-auto mt-8 max-w-[40rem] text-[clamp(1.25rem,2vw,1.625rem)] leading-snug font-medium text-balance text-ink/80">
            {t("lead")}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href={appUrl} className="pill pill-ink">
              {t("cta")}
            </a>
            <a href="#week" className="pill pill-quiet">
              {t("ctaSecondary")}
            </a>
          </div>

          {/* The conversation: a low-appetite day after the shot. */}
          <div className="mx-auto mt-16 grid max-w-6xl items-center gap-6 rounded-[var(--radius-stage)] bg-peach p-5 text-left sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10 lg:p-12">
            <ClayImage
              slot="glp1-hero"
              priority
              alt=""
              sizes="(min-width: 1024px) 520px, 90vw"
              className="aspect-[740/540]"
            />
            <div className="flex flex-col gap-5">
              <Bubble from="user">{t("chat.ask")}</Bubble>
              <Answer name={live("coach")} status={live("synced")}>
                {t("chat.answer")}
              </Answer>
            </div>
          </div>
        </section>

        <section
          id="week"
          className="mx-auto max-w-[90rem] scroll-mt-20 px-3 pb-24 sm:px-4 sm:pb-32"
        >
          <Glp1Week
            image={
              // A week of small meals, starting from the injection-day dot.
              <ClayImage
                slot="glp1-rhythm"
                alt=""
                sizes="(min-width: 768px) 42rem, 100vw"
                className="mx-auto mt-6 aspect-[1504/320] max-w-2xl"
              />
            }
          />
        </section>

        <section className="mx-auto max-w-[90rem] px-3 pb-24 sm:px-4 sm:pb-32">
          <h2 className="headline mx-auto max-w-[16ch] text-center text-[clamp(2.5rem,5.5vw,4.75rem)]">
            {noBreak(t("features.title"))}
          </h2>
          <div className="mt-14 grid gap-3 sm:gap-4 lg:grid-cols-3">
            {PICTURED.map((f) => (
              <article
                key={f.key}
                className={`flex flex-col overflow-hidden rounded-[var(--radius-stage)] ${f.bg}`}
              >
                <div className="p-8 pb-0 sm:p-10 sm:pb-0">
                  <h3 className="headline text-[clamp(1.75rem,2.4vw,2.25rem)]">
                    {t(`features.items.${f.key}.title`)}
                  </h3>
                  <p className="mt-3 text-[clamp(1.0625rem,1.3vw,1.25rem)] leading-snug font-semibold text-ink/80">
                    {t(`features.items.${f.key}.body`)}
                  </p>
                </div>
                <ClayImage
                  slot={f.slot}
                  alt=""
                  sizes="(min-width: 1024px) 33vw, 100vw"
                  className="mt-auto aspect-[4/3] min-h-56"
                />
              </article>
            ))}
          </div>
          <dl className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 md:grid-cols-2">
            {PLAIN.map((f) => (
              <div
                key={f}
                className="rounded-[var(--radius-stage)] bg-mist p-8 sm:p-10"
              >
                <dt className="headline text-[clamp(1.75rem,2.4vw,2.25rem)]">
                  {t(`features.items.${f}.title`)}
                </dt>
                <dd className="mt-3 max-w-lg text-[clamp(1.0625rem,1.3vw,1.25rem)] leading-snug font-semibold text-ink/80">
                  {t(`features.items.${f}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="px-3 pb-24 sm:px-4 sm:pb-32">
          <div className="stage mx-auto max-w-[90rem] bg-ink text-center text-paper">
            <h2 className="headline mx-auto max-w-[18ch] text-[clamp(2.25rem,4.5vw,4rem)]">
              {noBreak(t("safety.title"))}
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-[clamp(1.125rem,1.6vw,1.375rem)] leading-snug font-medium text-paper/80">
              {t("safety.body")}
            </p>
          </div>
        </section>

        <Faq ns="glp1.faq" keys={FAQ_KEYS} />
        <p className="mx-auto -mt-16 max-w-4xl px-5 pb-24 text-sm text-graphite sm:px-8">
          {t("trademark")}
        </p>
        <Cta />
      </main>
      <SiteFooter />
    </>
  );
}
