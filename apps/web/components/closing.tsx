import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { localeNames, routing } from "@/i18n/routing";
import { appUrl } from "@/lib/app-url";
import { ClayImage } from "./clay-image";

const promises = ["eu", "encryption", "keys"] as const;

export function Privacy() {
  const t = useTranslations("privacy");
  return (
    <section
      id="privacy"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 pb-24 sm:px-4 sm:pb-32"
    >
      <h2 className="headline mx-auto max-w-[14ch] px-2 text-center text-[clamp(2.5rem,5.5vw,4.75rem)]">
        {t("title")}
      </h2>
      <dl className="mx-auto mt-14 grid max-w-6xl gap-x-10 gap-y-10 px-2 sm:grid-cols-3">
        {promises.map((p) => (
          <div key={p} className="border-t-2 border-ink pt-6">
            <dt className="headline text-[1.75rem]">{t(`${p}.title`)}</dt>
            <dd className="mt-3 text-[1.0625rem] leading-relaxed text-graphite">
              {t(`${p}.body`)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Cta() {
  const t = useTranslations("cta");
  return (
    <section className="px-3 sm:px-4">
      <div className="stage mx-auto grid max-w-[90rem] items-center gap-6 overflow-hidden bg-sage pb-0 text-center sm:pb-0 lg:grid-cols-2 lg:pb-[clamp(2rem,6vw,5rem)] lg:text-left">
        <div>
          <h2 className="display text-[clamp(3rem,8vw,7rem)]">{t("title")}</h2>
          <p className="lead mt-6 text-ink/70 max-lg:mx-auto">{t("lead")}</p>
          <a href={appUrl} className="pill pill-ink mt-9">
            {t("button")}
          </a>
        </div>
        <ClayImage
          slot="cta"
          alt=""
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="aspect-square"
        />
      </div>
    </section>
  );
}

export function SiteFooter() {
  const t = useTranslations("footer");
  const legal = useTranslations("legal");
  return (
    <footer className="mx-auto max-w-[90rem] px-5 pt-20 pb-12 sm:px-8">
      <div className="flex flex-col gap-10 border-t border-line pt-10 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="headline text-3xl">VITLS</p>
          <p className="mt-2 text-graphite">{t("tagline")}</p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[0.9375rem]">
          {routing.locales.map((l) => (
            <li key={l}>
              <Link
                href="/"
                locale={l}
                className="text-graphite hover:text-ink"
              >
                {localeNames[l]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-graphite">
        <span>{t("rights")}</span>
        <Link href="/legal" className="hover:text-ink">
          {legal("link")}
        </Link>
        <a href="/llms.txt" className="hover:text-ink">
          {t("agents")}
        </a>
      </p>
    </footer>
  );
}
