import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/closing";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/legal">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "legal",
  });
  return {
    title: `${t("title")} | VITLS`,
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}/legal`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}/legal`])),
        "x-default": `/${routing.defaultLocale}/legal`,
      },
    },
  };
}

/** Operator details (Czech e-commerce/civil-code disclosure) and the website privacy notice. */
export default async function LegalPage({
  params,
}: PageProps<"/[locale]/legal">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("legal");
  const operator = t.raw("operator") as string[];
  const sections = t.raw("sections") as [string, string][];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pt-36 pb-24 sm:px-8 sm:pt-44">
        <h1 className="headline text-[clamp(2.5rem,6vw,4.5rem)]">
          {t("title")}
        </h1>
        {t("note") && <p className="mt-4 text-graphite">{t("note")}</p>}

        <section className="mt-14">
          <h2 className="headline text-[1.75rem]">{t("operatorTitle")}</h2>
          <address className="mt-4 text-[1.0625rem] leading-relaxed not-italic">
            {operator.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </section>

        <section className="mt-14">
          <h2 className="headline text-[1.75rem]">{t("privacyTitle")}</h2>
          <p className="mt-2 text-sm text-graphite">{t("updated")}</p>
          {sections.map(([heading, body]) => (
            <div key={heading} className="mt-8">
              <h3 className="text-lg font-semibold">{heading}</h3>
              <p className="mt-2 text-[1.0625rem] leading-relaxed text-ink/80">
                {body}
              </p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
