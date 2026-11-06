import { OG_SIZE, ogCard, ogMessages } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";

export async function generateImageMetadata({
  params,
}: {
  params: { locale: string };
}) {
  const { glp1 } = await ogMessages(params.locale);
  return [{ id: "og", alt: glp1.metaTitle, size, contentType }];
}

/** Share card for the GLP-1 landing page. */
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { glp1 } = await ogMessages((await params).locale);
  return ogCard({
    title: glp1.title,
    lead: glp1.ogTitle,
    image: { src: "/images/glp1-hero.png", width: 480, height: 350 },
    background: "#ffe2d1",
  });
}
