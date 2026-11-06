import { useTranslations } from "next-intl";
import { ClayImage } from "./clay-image";

const tiles = [
  {
    key: "nutrition",
    bg: "bg-peach",
    grid: "lg:row-span-2",
    image: "aspect-square lg:aspect-auto lg:flex-1",
  },
  {
    key: "training",
    bg: "bg-sky",
    grid: "lg:col-span-2",
    image: "aspect-[16/9] lg:aspect-[21/9]",
    sizes: "(min-width: 1024px) 66vw, 100vw",
  },
  { key: "recovery", bg: "bg-lilac", grid: "", image: "aspect-[4/3]" },
  { key: "body", bg: "bg-butter", grid: "", image: "aspect-[4/3]" },
] as const;

export function WholeBody() {
  const t = useTranslations("wholeBody");
  return (
    <section
      id="wholeBody"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 py-24 sm:px-4 sm:py-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[16ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>

      <div className="mt-14 grid gap-3 sm:gap-4 lg:grid-cols-3">
        {tiles.map((tile) => (
          <article
            key={tile.key}
            className={`flex flex-col overflow-hidden rounded-[var(--radius-stage)] ${tile.bg} ${tile.grid}`}
          >
            <div className="p-8 pb-0 sm:p-10 sm:pb-0">
              <h3 className="headline text-[clamp(1.875rem,3vw,3rem)]">
                {t(`${tile.key}.title`)}
              </h3>
              <p className="mt-3 max-w-md text-[clamp(1.1875rem,1.9vw,1.75rem)] leading-snug font-semibold text-ink/85">
                {t(`${tile.key}.body`)}
              </p>
            </div>
            <ClayImage
              slot={tile.key}
              alt=""
              sizes={
                "sizes" in tile ? tile.sizes : "(min-width: 1024px) 33vw, 100vw"
              }
              className={`mt-6 min-h-56 ${tile.image}`}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
