import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8081";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        },
      ],
    },
  ],
  // A2A discovery on the marketing domain resolves to the app's live agent card.
  rewrites: async () => [
    {
      source: "/.well-known/agent-card.json",
      destination: `${appUrl}/.well-known/agent-card.json`,
    },
  ],
};

export default createNextIntlPlugin()(nextConfig);
