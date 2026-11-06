import { randomBytes } from "node:crypto";

import { configureFieldKeys, parseFieldKeys } from "../db/encrypted";

/** Boots an isolated in-memory PGlite database (DATABASE_URL is set in vitest.config.ts) with VITLS migrations and a throwaway field key. */
export async function setupTestDb(): Promise<void> {
  configureFieldKeys(parseFieldKeys(`test:${randomBytes(32).toString("base64")}`));
  const { withMigrationRuntime } = await import("@agent-native/core/db");
  const { runVitlsMigrations } = await import("../plugins/db");
  await withMigrationRuntime(async () => {
    await runVitlsMigrations(null);
  });
}
