/**
 * Imports open food composition tables into the shared food reference (docs/design/06-nutrition.md §2).
 *   pnpm --filter @vitls/app foods:import            # all sources found in .cache/foods
 *   pnpm --filter @vitls/app foods:import ciqual     # one source
 *   pnpm --filter @vitls/app foods:import -- --yes   # required when the database is not local
 * Put the downloaded files in apps/app/.cache/foods/: usda/ (Foundation + SR Legacy CSV merged into one folder,
 * see scripts/foods/usda.ts), ciqual.xlsx, bls.xlsx.
 * Uses DATABASE_URL like the app (the dev Postgres or a pglite: path); the target is printed before anything runs.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { closeDbExec, getRuntimeDatabaseUrl, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";

import { runVitlsMigrations } from "../server/plugins/db";
import { upsertFoods, type ImportedFood } from "../server/lib/foods/store";
import { BLS_SPEC } from "./foods/bls";
import { CIQUAL_SPEC } from "./foods/ciqual";
import { parseTabular, readXlsx } from "./foods/tabular";
import { parseUsda } from "./foods/usda";

loadEnv();

const cache = fileURLToPath(new URL("../.cache/foods/", import.meta.url));
const SOURCES: Record<string, { path: string; load: (p: string) => Promise<ImportedFood[]> }> = {
  usda: { path: `${cache}usda`, load: async (p) => parseUsda(p) },
  ciqual: { path: `${cache}ciqual.xlsx`, load: async (p) => parseTabular(await readXlsx(p), CIQUAL_SPEC) },
  bls: { path: `${cache}bls.xlsx`, load: async (p) => parseTabular(await readXlsx(p), BLS_SPEC) },
};

/** Where the import writes, without credentials, and whether that is this machine. */
function describeTarget(url: string): { label: string; local: boolean } {
  if (!url || url.toLowerCase().startsWith("pglite:")) return { label: `PGlite ${url.slice("pglite:".length) || "(default path)"}`, local: true };
  try {
    const { hostname, port, pathname } = new URL(url);
    return { label: `Postgres ${hostname}${port ? `:${port}` : ""}${pathname}`, local: ["localhost", "127.0.0.1", "[::1]"].includes(hostname) };
  } catch {
    return { label: "an unparseable DATABASE_URL", local: false };
  }
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const confirmed = args.includes("--yes");
const named = args.filter((a) => !a.startsWith("--"));
const unknown = named.filter((name) => !SOURCES[name]);
if (unknown.length) {
  console.error(`Unknown source ${unknown.map((n) => `"${n}"`).join(", ")} (usda, ciqual, bls)`);
  process.exit(1);
}
const target = describeTarget(getRuntimeDatabaseUrl());
console.log(`Target database: ${target.label}`);
if (!target.local && !confirmed) {
  console.error("Not a local database — re-run with --yes to import into it.");
  process.exit(1);
}

const wanted = named.length ? named : Object.keys(SOURCES);
let imported = 0;
try {
  await withMigrationRuntime(async () => {
    await runVitlsMigrations(null);
  });
  for (const name of wanted) {
    const source = SOURCES[name]!;
    if (!existsSync(source.path)) {
      console.warn(`skip ${name}: ${source.path} not found`);
      continue;
    }
    const foods = await source.load(source.path);
    const result = await upsertFoods(foods);
    imported += foods.length;
    console.log(`${name}: ${foods.length} foods (${result.inserted} new, ${result.updated} updated)`);
  }
} finally {
  await closeDbExec();
}
if (imported === 0) {
  console.error(`Nothing imported — put the source files in ${cache}`);
  process.exitCode = 1;
}
