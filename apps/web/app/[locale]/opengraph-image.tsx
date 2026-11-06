import { OG_SIZE, ogCard, ogMessages } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";

// Unlike the image function, generateImageMetadata receives params as a plain object.
export async function generateImageMetadata({
  params,
}: {
  params: { locale: string };
}) {
  const { meta } = await ogMessages(params.locale);
  return [{ id: "og", alt: meta.title, size, contentType }];
}

/** Share card per locale: the hero headline next to the clay runner. */
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { hero } = await ogMessages((await params).locale);
  return ogCard({
    title: hero.title,
    lead: hero.lead.split(/(?<=\.)\s+/)[0],
    image: { src: "/images/hero.png", width: 420, height: 412 },
    background: "#d7e6ff",
  });
}
