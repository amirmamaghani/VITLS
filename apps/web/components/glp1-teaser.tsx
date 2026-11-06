import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { noBreak } from "@/lib/no-break";
import { Glp1Week } from "./glp1-week";

/** Home-page section for people on GLP-1 therapy: the injection-week view and a link to the full page. */
export function Glp1Teaser() {
  const t = useTranslations("glp1.teaser");
  return (
    <section
      id="glp1"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 pb-24 sm:px-4 sm:pb-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[16ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {noBreak(t("title"))}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-[clamp(1.125rem,1.7vw,1.5rem)] leading-snug font-semibold text-balance text-ink/75">
          {t("lead")}
        </p>
      </div>
      <div className="mt-12">
        <Glp1Week />
      </div>
      <div className="mt-8 flex justify-center">
        <Link href="/glp1" className="pill pill-ink">
          {t("link")}
        </Link>
      </div>
    </section>
  );
}
