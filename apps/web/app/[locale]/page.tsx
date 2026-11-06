import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Audiences } from "@/components/audiences";
import { Cta, Privacy, SiteFooter } from "@/components/closing";
import { Coaches } from "@/components/coaches";
import { Devices } from "@/components/devices";
import { EarlyAccess } from "@/components/early-access";
import { Faq } from "@/components/faq";
import { Goals } from "@/components/goals";
import { Hero } from "@/components/hero";
import { Memory } from "@/components/memory";
import { Progress } from "@/components/progress";
import { Signal } from "@/components/signal";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { WholeBody } from "@/components/whole-body";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <>
      <StructuredData locale={locale as Locale} />
      <SiteHeader />
      <main>
        <Hero />
        <Signal />
        <Audiences />
        <WholeBody />
        <Devices />
        <Memory />
        <Goals />
        <Progress />
        <Coaches />
        <Privacy />
        <EarlyAccess />
        <Faq />
        <Cta />
      </main>
      <SiteFooter />
    </>
  );
}
