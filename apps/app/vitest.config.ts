import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    // Every test file gets its own in-memory PGlite database (see server/test/db.ts).
    env: { DATABASE_URL: "pglite:memory://" },
    // PGlite boot + migrations per file; 30 s matches @agent-native/core/vitest-config.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.react-router/**",
    ],
  },
});
