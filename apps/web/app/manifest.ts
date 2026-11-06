import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VITLS: AI Health & Longevity Coach",
    short_name: "VITLS",
    description:
      "An AI coach you chat with. It reads live data from your watch and wearables, remembers your story and tells you what to do today.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
