import { useTranslations } from "next-intl";
import { ClayImage } from "./clay-image";
import { CoachPicker, type Persona } from "./coach-picker";

const personas: Persona[] = ["strict", "scientist", "supportive", "longevity"];

export function Coaches() {
  const t = useTranslations("coaches");
  return (
    <section
      id="coaches"
      className="mx-auto max-w-[90rem] scroll-mt-20 px-3 py-24 sm:px-4 sm:py-32"
    >
      <div className="px-2 text-center">
        <h2 className="headline mx-auto max-w-[15ch] text-[clamp(2.5rem,5.5vw,4.75rem)]">
          {t("title")}
        </h2>
        <p className="lead mx-auto mt-5">{t("lead")}</p>
      </div>
      <CoachPicker
        personas={personas}
        avatars={Object.fromEntries(
          personas.map((p) => [
            p,
            <ClayImage
              key={p}
              slot={`coach-${p}`}
              alt=""
              sizes="(min-width: 1024px) 20vw, 50vw"
              className="aspect-square"
            />,
          ]),
        )}
      />
    </section>
  );
}
