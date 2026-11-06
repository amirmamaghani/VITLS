import { readFile } from "node:fs/promises";
import { hasLocale } from "next-intl";
import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";
import { join } from "node:path";

/** Fetch one static TTF instance from Google Fonts (ImageResponse can't use woff2 or variable fonts). */
async function googleFont(family: string): Promise<ArrayBuffer> {
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=${family}`)
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('truetype'\)/)?.[1];
  if (!url) throw new Error(`No TTF for ${family}`);
  return (await fetch(url)).arrayBuffer();
}

/** Fonts for generated images: rounded Google Sans Flex Black (Latin) + Google Sans Bold (Cyrillic). */
async function ogFonts() {
  const [black, semibold, cyrillic] = await Promise.all([
    googleFont("Google+Sans+Flex:ROND,wght@100,900"),
    googleFont("Google+Sans+Flex:ROND,wght@100,600"),
    googleFont("Google+Sans:wght@700"),
  ]);
  return [
    {
      name: "Flex",
      data: black,
      weight: 900 as const,
      style: "normal" as const,
    },
    {
      name: "Flex",
      data: semibold,
      weight: 600 as const,
      style: "normal" as const,
    },
    {
      name: "Cyrillic",
      data: cyrillic,
      weight: 700 as const,
      style: "normal" as const,
    },
  ];
}

/** A file from public/ as a data URL, for <img> inside ImageResponse. */
async function publicImage(path: string) {
  const data = await readFile(join(process.cwd(), "public", path));
  return `data:image/png;base64,${data.toString("base64")}`;
}

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Messages for image routes, read directly: next-intl's request APIs need headers(),
 * which image metadata generation (a build-time context) can't use.
 */
export const ogMessages = (locale: string) =>
  import(
    `../messages/${hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}.json`
  ).then((m) => m.default);

/** The shared share-card layout: rounded Black headline and a lead line next to a clay render. */
export async function ogCard({
  title,
  lead,
  image,
  background,
}: {
  title: string;
  lead: string;
  image: { src: string; width: number; height: number };
  background: string;
}) {
  const [fonts, src] = await Promise.all([ogFonts(), publicImage(image.src)]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        background,
        padding: "64px 56px 64px 80px",
        fontFamily: "Flex, Cyrillic",
        color: "#202124",
      }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", flex: 1, gap: 28 }}
      >
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: -1 }}>
          VITLS
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: -3,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: "rgba(32,33,36,0.75)",
          }}
        >
          {lead}
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
      <img
        src={src}
        width={image.width}
        height={image.height}
        alt=""
        style={{ marginLeft: 24 }}
      />
    </div>,
    { ...OG_SIZE, fonts },
  );
}
