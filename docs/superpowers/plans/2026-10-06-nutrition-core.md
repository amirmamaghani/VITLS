# Nutrition Core Implementation Plan (plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach can log meals from text (and, after plan 2, photos) against an open food database, every meal updates daily `intake_*` metrics, and a meal card renders in chat.

**Architecture:** A nutrient catalog beside the metric catalog in `@vitls/health-ingest`; shared reference tables (`foods`, `food_nutrients`, `food_portions`, `food_names`) filled by an import script from USDA, CIQUAL and BLS, plus on-demand Open Food Facts; owner-scoped `meals` / `meal_items` with per-item nutrient snapshots; each meal write recomputes that day's `intake_*` rows in `daily_metrics` under a per-user "vitls/food" source, so every existing chart, widget and `get-health` trend works unchanged. Actions are thin wrappers over `server/lib/foods` and `server/lib/meals`.

**Tech Stack:** TypeScript, agent-native core 0.198.8 (`defineAction`, `runMigrations`, `runWithRequestContext`, `recordChange`), Drizzle on Postgres/TimescaleDB (PGlite in tests), Vitest, zod 4, `csv-parse` and `exceljs` (import script only), React + toolkit chat renderers.

**Spec:** `docs/design/06-nutrition.md` (§1–§5, §9, §10). Out of this plan: photos (§6, plan 2), `/food` page, `nutrition`/`meals` widgets, targets and Slovak/Czech name translation (plan 3), GLP-1 and doctor export (plan 4), Apple Health / Health Connect import-export (plan 5).

## Global Constraints

- Communicate with the user in Slovak; all code, comments, docs and commit messages in English.
- Stage only files you changed (`git add <paths>`), never `git add -A` — another worker edits `apps/web`.
- Migrations are append-only: unique `version` and `name`, additive, no DROP/RENAME, no NOT NULL without DEFAULT (`server/plugins/db.ts` header).
- User data rows use `ownableColumns()`; personal tables are added to `PERSONAL_HEALTH_TABLES` in `server/db/index.ts` (offboard = delete).
- Encrypted columns (`encryptedText`/`encryptedJson`) are written only inside a request context (`runWithRequestContext`).
- No inline LLM calls in actions; recognition is done by the coach agent.
- Food sources and licenses: USDA FoodData Central (CC0), ANSES CIQUAL 2025 (Etalab Open License 2.0), BLS 4.0 (CC BY 4.0), Open Food Facts (ODbL, live API + per-product cache only, never a full dump).
- Meal types are exactly `breakfast | lunch | dinner | snack` (or null) — the HealthKit / Health Connect enum.
- Canonical nutrient units: `kcal`, `g`, `mg`, `ug`, `ml`; amounts stored per `100g` or `100ml` basis.
- Tone follows the persona; a persona may be blunt about numbers but never attacks the person.
- Verification after each task: `pnpm --filter @vitls/app test`, `pnpm --filter @vitls/app typecheck`; at the end also `pnpm --filter @vitls/app doctor`.

## Review Focus

1. **Meal near local midnight** — a meal at 00:30 Europe/Prague belongs to that local day, not the previous UTC day. Test in Task 7.
2. **Moving a meal to another day** (edit `eatenAt`) — both the old and the new day's `intake_*` are recomputed. Test in Task 7.
3. **Food missing a nutrient** (e.g. no fiber in the source) — item snapshot omits it; day totals never contain `NaN` and other nutrients still sum. Test in Task 7.
4. **Unit mismatch or unknown portion** (`ml` for a per-100 g food, a portion label the food doesn't have) — a clear 400 error naming the food, nothing written. Test in Task 7.
5. **Open Food Facts down or slow** — `search-foods` still returns local results within the timeout and does not throw. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/health-ingest/src/nutrients.ts` (create) | Nutrient catalog: key, unit, HealthKit/Health Connect ids, intake metric key |
| `packages/health-ingest/src/catalog.ts` (modify) | Adds `g/mg/ug/ml` units and the `intake_*` daily metrics from the nutrient catalog |
| `packages/health-ingest/src/units.ts` (modify) | Conversions for the new units |
| `apps/app/server/db/schema.ts`, `server/plugins/db.ts`, `server/db/index.ts` (modify) | Food and meal tables, migrations 13–14, identity registration |
| `apps/app/server/lib/foods/normalize.ts` (create) | `searchKey()` — lowercase, diacritics stripped |
| `apps/app/server/lib/foods/store.ts` (create) | `upsertFoods()` (import + cache), `getFoods()` |
| `apps/app/server/lib/foods/search.ts` (create) | Local search + ranking |
| `apps/app/server/lib/foods/off.ts` (create) | Open Food Facts client (barcode, text) with timeout |
| `apps/app/scripts/foods/{usda,tabular,ciqual,bls}.ts` + `scripts/foods-import.ts` (create) | Source parsers and the import CLI |
| `apps/app/server/lib/meals/meals.ts` (create) | `logMeal`, `deleteMeal`, `listMeals`, `createFood` |
| `apps/app/server/lib/meals/intake.ts` (create) | Food source + `recomputeIntakeDay()` |
| `apps/app/actions/{search-foods,log-meal,delete-meal,create-food}.ts` (create), `actions/get-health.ts` (modify) | Agent/UI surface |
| `apps/app/shared/meals.ts` (create) | Meal types shared by server and UI |
| `apps/app/app/components/meals/MealCard.tsx` (create), `app/lib/register-chat-renderers.tsx`, `app/components/dashboard/HealthWidget.tsx` (modify) | Meal card + `vitls.meal` renderer, intake metric formatting/tint |
| `apps/app/.agents/skills/food-logging/SKILL.md` (create), `apps/app/AGENTS.md`, `server/plugins/agent-chat.ts`, `docs/design/03-coach.md` (modify) | Coach behaviour |

---

### Task 1: Nutrient catalog and intake metrics

**Files:**
- Create: `packages/health-ingest/src/nutrients.ts`, `packages/health-ingest/src/nutrients.test.ts`
- Modify: `packages/health-ingest/src/catalog.ts`, `packages/health-ingest/src/units.ts`, `packages/health-ingest/src/index.ts`

**Interfaces:**
- Produces: `NUTRIENTS: readonly NutrientDefinition[]`, `type NutrientKey`, `getNutrient(key)`, `intakeMetric(key: NutrientKey): string` (`"intake_" + key`), `isNutrientKey(key: string): key is NutrientKey`; catalog metrics `intake_<key>` (daily, sum, free tier); `CanonicalUnit` gains `"g" | "mg" | "ug" | "ml"`.

- [ ] **Step 1: Write the failing test** — `packages/health-ingest/src/nutrients.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { getMetric } from "./catalog";
import { NUTRIENTS, getNutrient, intakeMetric, isNutrientKey } from "./nutrients";
import { normalizeValue } from "./units";

describe("nutrient catalog", () => {
  it("maps every nutrient to a daily summed intake metric in the same unit", () => {
    for (const n of NUTRIENTS) {
      const m = getMetric(intakeMetric(n.key));
      expect(m, n.key).toMatchObject({ kind: "daily", aggregation: "sum", unit: n.unit, tier: "free" });
    }
  });

  it("covers the macro set with HealthKit and Health Connect ids", () => {
    for (const key of ["energy", "protein", "fat", "carbs", "fiber", "sugars", "sodium", "water"]) {
      const n = getNutrient(key);
      expect(n?.healthKit, key).toMatch(/^HKQuantityTypeIdentifierDietary/);
      expect(n?.healthConnect, key).toBeTruthy();
    }
    expect(isNutrientKey("protein")).toBe(true);
    expect(isNutrientKey("intake_protein")).toBe(false);
  });

  it("converts mg/g and l/ml", () => {
    expect(normalizeValue("intake_sodium", 1.2, "g")).toBeCloseTo(1200);
    expect(normalizeValue("intake_protein", 500, "mg")).toBeCloseTo(0.5);
    expect(normalizeValue("intake_water", 1.5, "l")).toBeCloseTo(1500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/health-ingest test -- nutrients`
Expected: FAIL — `Cannot find module './nutrients'`.

- [ ] **Step 3: Implement** — `packages/health-ingest/src/nutrients.ts`

```ts
/**
 * Nutrient catalog: the nutrients VITLS tracks, in canonical units per 100 g/ml of food and per day of intake.
 * Each maps 1:1 to Apple HealthKit (HKQuantityTypeIdentifierDietary…) and Health Connect (NutritionRecord field),
 * so meals can be imported from and exported to both. Adding a nutrient is one entry (docs/design/06-nutrition.md §3).
 */
export type NutrientUnit = "kcal" | "g" | "mg" | "ug" | "ml";

export interface NutrientDefinition {
  key: string;
  unit: NutrientUnit;
  label: string;
  /** HKQuantityTypeIdentifier…; null when HealthKit has no dietary type for it. */
  healthKit: string | null;
  /** Health Connect NutritionRecord field (water: HydrationRecord.volume). */
  healthConnect: string | null;
}

const n = (key: string, unit: NutrientUnit, label: string, hk: string | null, hc: string | null): NutrientDefinition => ({
  key,
  unit,
  label,
  healthKit: hk ? `HKQuantityTypeIdentifierDietary${hk}` : null,
  healthConnect: hc,
});

export const NUTRIENTS = [
  n("energy", "kcal", "Energy", "EnergyConsumed", "energy"),
  n("protein", "g", "Protein", "Protein", "protein"),
  n("fat", "g", "Fat", "FatTotal", "totalFat"),
  n("saturated_fat", "g", "Saturated fat", "FatSaturated", "saturatedFat"),
  n("carbs", "g", "Carbohydrates", "Carbohydrates", "totalCarbohydrate"),
  n("sugars", "g", "Sugars", "Sugar", "sugar"),
  n("fiber", "g", "Fiber", "Fiber", "dietaryFiber"),
  n("sodium", "mg", "Sodium", "Sodium", "sodium"),
  n("potassium", "mg", "Potassium", "Potassium", "potassium"),
  n("cholesterol", "mg", "Cholesterol", "Cholesterol", "cholesterol"),
  n("calcium", "mg", "Calcium", "Calcium", "calcium"),
  n("iron", "mg", "Iron", "Iron", "iron"),
  n("magnesium", "mg", "Magnesium", "Magnesium", "magnesium"),
  n("vitamin_c", "mg", "Vitamin C", "VitaminC", "vitaminC"),
  n("vitamin_d", "ug", "Vitamin D", "VitaminD", "vitaminD"),
  n("caffeine", "mg", "Caffeine", "Caffeine", "caffeine"),
  n("water", "ml", "Water", "Water", "volume"),
  n("alcohol", "g", "Alcohol", null, null),
] as const satisfies readonly NutrientDefinition[];

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];

const byKey = new Map<string, NutrientDefinition>(NUTRIENTS.map((x) => [x.key, x]));

export const getNutrient = (key: string): NutrientDefinition | undefined => byKey.get(key);
export const isNutrientKey = (key: string): key is NutrientKey => byKey.has(key);
export const intakeMetric = (key: NutrientKey | string): string => `intake_${key}`;
```

Modify `packages/health-ingest/src/catalog.ts`:
- Extend `CanonicalUnit` with `| "g" | "mg" | "ug" | "ml"`.
- At the top: `import { NUTRIENTS } from "./nutrients";`
- After the intraday entries inside `METRICS`, append:

```ts
  // Nutrition intake (docs/design/06-nutrition.md §3): daily totals recomputed from the food log.
  ...NUTRIENTS.map((x) => daily(`intake_${x.key}`, x.unit, "sum", `${x.label} eaten (food log)`)),
```

Modify `packages/health-ingest/src/units.ts` — add to `CONVERSIONS`:

```ts
  g: { mg: 0.001, ug: 0.000001, kg: 1000 },
  mg: { g: 1000, ug: 0.001 },
  ug: { mg: 1000, g: 1_000_000 },
  ml: { l: 1000, cl: 10, dl: 100 },
```

Modify `packages/health-ingest/src/index.ts`: add `export * from "./nutrients";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vitls/health-ingest test && pnpm --filter @vitls/health-ingest typecheck`
Expected: PASS (existing catalog/units tests still pass).

- [ ] **Step 5: Commit**

```bash
git add packages/health-ingest/src/nutrients.ts packages/health-ingest/src/nutrients.test.ts packages/health-ingest/src/catalog.ts packages/health-ingest/src/units.ts packages/health-ingest/src/index.ts
git commit -m "feat(health-ingest): nutrient catalog and daily intake metrics"
```

---

### Task 2: Food and meal tables

**Files:**
- Modify: `apps/app/server/db/schema.ts`, `apps/app/server/plugins/db.ts`, `apps/app/server/db/index.ts`
- Create: `apps/app/server/lib/foods/normalize.ts`, `apps/app/server/lib/foods/normalize.test.ts`, `apps/app/server/db/food-tables.test.ts`

**Interfaces:**
- Produces: Drizzle tables `schema.foods`, `schema.foodNutrients`, `schema.foodPortions`, `schema.foodNames`, `schema.meals`, `schema.mealItems`; `searchKey(text: string): string`.

- [ ] **Step 1: Write the failing tests**

`apps/app/server/lib/foods/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { searchKey } from "./normalize";

describe("searchKey", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(searchKey("  Tvaroh   POLOTUČNÝ ")).toBe("tvaroh polotucny");
    expect(searchKey("Crème fraîche, épaisse")).toBe("creme fraiche epaisse");
  });
});
```

`apps/app/server/db/food-tables.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../test/db";
import { getDb } from ".";

describe("food and meal tables", () => {
  beforeAll(setupTestDb);

  it("exist after migrations", async () => {
    const rows = await getDb().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('foods','food_nutrients','food_portions','food_names','meals','meal_items') ORDER BY table_name`,
    );
    expect((rows.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual([
      "food_names", "food_nutrients", "food_portions", "foods", "meal_items", "meals",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vitls/app test -- normalize food-tables`
Expected: FAIL — module `./normalize` not found; table list empty.

- [ ] **Step 3: Implement**

`apps/app/server/lib/foods/normalize.ts`:

```ts
/** Search key for food names: lowercase, no diacritics, punctuation as spaces ("Tvaroh polotučný" → "tvaroh polotucny"). */
export const searchKey = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
```

Append to `apps/app/server/db/schema.ts` (add `encryptedText` to the `./encrypted` import):

```ts
/**
 * Food reference data (docs/design/06-nutrition.md §2–§3): shared, not PHI. `created_by` is set only for a user's
 * own foods (visible to their author); reference rows from USDA/CIQUAL/BLS/Open Food Facts have it null.
 */
export const foods = table(
  "foods",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["usda", "ciqual", "bls", "off", "custom"] }).notNull(),
    sourceRef: text("source_ref").notNull(),
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"),
    basis: text("basis", { enum: ["100g", "100ml"] }).notNull().default("100g"),
    createdBy: text("created_by"),
    refreshedAt: text("refreshed_at").notNull(),
  },
  (t) => [uniqueIndex("foods_source_ref_uq").on(t.source, t.sourceRef), index("foods_barcode_idx").on(t.barcode)],
);

/** Nutrients per basis (100 g or 100 ml), long layout keyed by the nutrient catalog. */
export const foodNutrients = table(
  "food_nutrients",
  { foodId: text("food_id").notNull(), nutrient: text("nutrient").notNull(), amount: doublePrecision("amount").notNull() },
  (t) => [primaryKey({ name: "food_nutrients_pk", columns: [t.foodId, t.nutrient] })],
);

/** Named portions ("1 egg" = 50 g); amount is in the food's basis unit (g or ml). */
export const foodPortions = table(
  "food_portions",
  { foodId: text("food_id").notNull(), label: text("label").notNull(), amount: doublePrecision("amount").notNull() },
  (t) => [primaryKey({ name: "food_portions_pk", columns: [t.foodId, t.label] })],
);

/** Names per language; search_name = searchKey(name). */
export const foodNames = table(
  "food_names",
  { foodId: text("food_id").notNull(), lang: text("lang").notNull(), name: text("name").notNull(), searchName: text("search_name").notNull() },
  (t) => [primaryKey({ name: "food_names_pk", columns: [t.foodId, t.lang] })],
);

/** One eaten meal (PHI). meal_type uses the HealthKit / Health Connect enum. */
export const meals = table(
  "meals",
  {
    id: text("id").primaryKey(),
    eatenAt: instant("eaten_at").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    mealType: text("meal_type", { enum: ["breakfast", "lunch", "dinner", "snack"] }),
    note: encryptedText("meals", "note"),
    entry: text("entry", { enum: ["photo", "barcode", "search", "manual", "copy", "import"] }).notNull(),
    source: text("source").notNull().default("vitls"),
    externalId: text("external_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [index("meals_owner_date_idx").on(t.ownerEmail, t.localDate)],
);

/** Meal items with a nutrient snapshot (totals for this amount), so reference updates never rewrite history. */
export const mealItems = table(
  "meal_items",
  {
    id: text("id").primaryKey(),
    mealId: text("meal_id").notNull(),
    position: integer("position").notNull(),
    foodId: text("food_id"),
    name: encryptedText("meal_items", "name"),
    amount: doublePrecision("amount").notNull(),
    unit: text("unit", { enum: ["g", "ml"] }).notNull(),
    nutrients: text("nutrients").notNull(),
    estimated: integer("estimated").notNull().default(0),
    ...ownableColumns(),
  },
  (t) => [index("meal_items_meal_idx").on(t.mealId)],
);
```

Append two entries to the migrations array in `apps/app/server/plugins/db.ts` (after version 12):

```ts
    {
      version: 13,
      name: "food-and-meal-tables",
      sql: `CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  basis TEXT NOT NULL DEFAULT '100g',
  created_by TEXT,
  refreshed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS foods_source_ref_uq ON foods (source, source_ref);
CREATE INDEX IF NOT EXISTS foods_barcode_idx ON foods (barcode);
CREATE TABLE IF NOT EXISTS food_nutrients (
  food_id TEXT NOT NULL,
  nutrient TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  CONSTRAINT food_nutrients_pk PRIMARY KEY (food_id, nutrient)
);
CREATE TABLE IF NOT EXISTS food_portions (
  food_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  CONSTRAINT food_portions_pk PRIMARY KEY (food_id, label)
);
CREATE TABLE IF NOT EXISTS food_names (
  food_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  CONSTRAINT food_names_pk PRIMARY KEY (food_id, lang)
);
CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  eaten_at TIMESTAMPTZ NOT NULL,
  local_date DATE NOT NULL,
  meal_type TEXT,
  note TEXT,
  entry TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'vitls',
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ${ownable}
);
CREATE INDEX IF NOT EXISTS meals_owner_date_idx ON meals (owner_email, local_date);
CREATE TABLE IF NOT EXISTS meal_items (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  food_id TEXT,
  name TEXT,
  amount DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  nutrients TEXT NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0,
  ${ownable}
);
CREATE INDEX IF NOT EXISTS meal_items_meal_idx ON meal_items (meal_id)`,
    },
    {
      version: 14,
      name: "food-names-trigram-index",
      // pg_trgm where available (local infra and managed Postgres) for typo-tolerant search; a no-op on PGlite.
      sql: {},
      run: async (exec) => {
        const available = await exec.execute("SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'");
        if (available.rows.length === 0) return;
        await exec.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        await exec.execute("CREATE INDEX IF NOT EXISTS food_names_search_trgm_idx ON food_names USING gin (search_name gin_trgm_ops)");
      },
    },
```

In `apps/app/server/db/index.ts`, add `"meals"` and `"meal_items"` to `PERSONAL_HEALTH_TABLES`, and register the custom-food author column after the existing `registerIdentityColumns(...)` call:

```ts
// A user's own foods (created_by) are personal too; reference foods have created_by NULL.
registerIdentityColumns([
  { table: "foods", column: "created_by", emailChange: "rekey", offboard: "delete", reason: "A user's own custom foods." },
]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vitls/app test -- normalize food-tables && pnpm --filter @vitls/app typecheck && pnpm --filter @vitls/app doctor`
Expected: PASS; doctor "Clean — no findings." (If `identity-columns-registered` flags `foods.created_by`, the registration above is what it wants; if it flags `meals`/`meal_items`, confirm they are in `PERSONAL_HEALTH_TABLES`.)

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/db/schema.ts apps/app/server/plugins/db.ts apps/app/server/db/index.ts apps/app/server/lib/foods/normalize.ts apps/app/server/lib/foods/normalize.test.ts apps/app/server/db/food-tables.test.ts
git commit -m "feat(app/nutrition): food reference and meal tables"
```

---

### Task 3: Food store (idempotent upsert and lookup)

**Files:**
- Create: `apps/app/server/lib/foods/store.ts`, `apps/app/server/lib/foods/store.test.ts`

**Interfaces:**
- Consumes: tables from Task 2, `searchKey`, `isNutrientKey`.
- Produces:

```ts
export type FoodSource = "usda" | "ciqual" | "bls" | "off" | "custom";
export interface ImportedFood {
  source: FoodSource;
  sourceRef: string;
  name: string;                       // display name (English where the source has it)
  names?: Record<string, string>;     // lang → name, e.g. { fr: "…", de: "…" }
  brand?: string;
  barcode?: string;
  basis: "100g" | "100ml";
  nutrients: Partial<Record<NutrientKey, number>>;
  portions?: { label: string; amount: number }[];
  createdBy?: string;                 // custom foods only
}
export interface Food {
  id: string; source: FoodSource; name: string; brand: string | null; barcode: string | null;
  basis: "100g" | "100ml"; nutrients: Partial<Record<NutrientKey, number>>; portions: { label: string; amount: number }[];
}
export function upsertFoods(rows: ImportedFood[]): Promise<{ inserted: number; updated: number; ids: string[] }>;
export function getFoods(ids: string[], viewer?: string): Promise<Map<string, Food>>;
export function foodByBarcode(barcode: string, viewer?: string): Promise<Food | null>; // custom foods only for their author
```

- [ ] **Step 1: Write the failing test** — `store.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { foodByBarcode, getFoods, upsertFoods, type ImportedFood } from "./store";

const egg: ImportedFood = {
  source: "usda",
  sourceRef: "748967",
  name: "Egg, whole, raw",
  names: { fr: "Œuf entier, cru" },
  basis: "100g",
  nutrients: { energy: 143, protein: 12.6, fat: 9.5, carbs: 0.7 },
  portions: [{ label: "1 large egg", amount: 50 }],
};

describe("food store", () => {
  beforeAll(setupTestDb);

  it("inserts once and updates on re-import (idempotent on source + ref)", async () => {
    const first = await upsertFoods([egg]);
    const second = await upsertFoods([{ ...egg, nutrients: { ...egg.nutrients, protein: 12.5 } }]);
    expect(first).toMatchObject({ inserted: 1, updated: 0 });
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    expect(second.ids).toEqual(first.ids);
    const food = (await getFoods(first.ids)).get(first.ids[0]!)!;
    expect(food).toMatchObject({ name: "Egg, whole, raw", basis: "100g", portions: [{ label: "1 large egg", amount: 50 }] });
    expect(food.nutrients).toEqual({ energy: 143, protein: 12.5, fat: 9.5, carbs: 0.7 });
  });

  it("drops unknown nutrients and non-finite amounts", async () => {
    const { ids } = await upsertFoods([{ ...egg, sourceRef: "x1", nutrients: { protein: Number.NaN, energy: 10, bogus: 3 } as never }]);
    expect((await getFoods(ids)).get(ids[0]!)!.nutrients).toEqual({ energy: 10 });
  });

  it("hides another user's custom food and finds by barcode", async () => {
    const { ids } = await upsertFoods([{ ...egg, source: "custom", sourceRef: "c1", barcode: "8590000000001", createdBy: "a@example.com" }]);
    expect((await getFoods(ids, "b@example.com")).size).toBe(0);
    expect((await getFoods(ids, "a@example.com")).size).toBe(1);
    expect((await foodByBarcode("8590000000001"))?.id).toBe(ids[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- foods/store`
Expected: FAIL — module `./store` not found.

- [ ] **Step 3: Implement** — `apps/app/server/lib/foods/store.ts`

```ts
/**
 * Food reference store (docs/design/06-nutrition.md §2–§3). Imports and the Open Food Facts cache go through
 * upsertFoods, idempotent on (source, source_ref). Reference foods are shared; custom foods are visible to their author.
 */
import { randomUUID } from "node:crypto";

import { isNutrientKey, type NutrientKey } from "@vitls/health-ingest";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";
import { searchKey } from "./normalize";

export type FoodSource = "usda" | "ciqual" | "bls" | "off" | "custom";

export interface ImportedFood {
  source: FoodSource;
  sourceRef: string;
  name: string;
  names?: Record<string, string>;
  brand?: string;
  barcode?: string;
  basis: "100g" | "100ml";
  nutrients: Partial<Record<NutrientKey, number>>;
  portions?: { label: string; amount: number }[];
  createdBy?: string;
}

export interface Food {
  id: string;
  source: FoodSource;
  name: string;
  brand: string | null;
  barcode: string | null;
  basis: "100g" | "100ml";
  nutrients: Partial<Record<NutrientKey, number>>;
  portions: { label: string; amount: number }[];
}

const CHUNK = 200;

export async function upsertFoods(rows: ImportedFood[]): Promise<{ inserted: number; updated: number; ids: string[] }> {
  const db = getDb();
  const now = new Date().toISOString();
  const ids: string[] = [];
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const row of chunk) {
        const [existing] = await tx
          .select({ id: schema.foods.id })
          .from(schema.foods)
          .where(and(eq(schema.foods.source, row.source), eq(schema.foods.sourceRef, row.sourceRef)));
        const id = existing?.id ?? randomUUID();
        const values = {
          name: row.name,
          brand: row.brand ?? null,
          barcode: row.barcode ?? null,
          basis: row.basis,
          createdBy: row.createdBy ?? null,
          refreshedAt: now,
        };
        if (existing) {
          await tx.update(schema.foods).set(values).where(eq(schema.foods.id, id));
          await tx.delete(schema.foodNutrients).where(eq(schema.foodNutrients.foodId, id));
          await tx.delete(schema.foodPortions).where(eq(schema.foodPortions.foodId, id));
          await tx.delete(schema.foodNames).where(eq(schema.foodNames.foodId, id));
          updated++;
        } else {
          await tx.insert(schema.foods).values({ id, source: row.source, sourceRef: row.sourceRef, ...values });
          inserted++;
        }
        const nutrients = Object.entries(row.nutrients).filter(([k, v]) => isNutrientKey(k) && typeof v === "number" && Number.isFinite(v) && v >= 0);
        if (nutrients.length) await tx.insert(schema.foodNutrients).values(nutrients.map(([nutrient, amount]) => ({ foodId: id, nutrient, amount: amount! })));
        const portions = [...new Map((row.portions ?? []).filter((p) => p.amount > 0).map((p) => [p.label, p])).values()];
        if (portions.length) await tx.insert(schema.foodPortions).values(portions.map((p) => ({ foodId: id, label: p.label, amount: p.amount })));
        const names = { en: row.name, ...row.names };
        await tx.insert(schema.foodNames).values(
          Object.entries(names)
            .filter(([, name]) => name?.trim())
            .map(([lang, name]) => ({ foodId: id, lang, name, searchName: searchKey(`${name} ${row.brand ?? ""}`) })),
        );
        ids.push(id);
      }
    });
  }
  return { inserted, updated, ids };
}

/** Loads foods by id; custom foods are returned only to their author. */
export async function getFoods(ids: string[], viewer?: string): Promise<Map<string, Food>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const visible = viewer ? or(isNull(schema.foods.createdBy), eq(schema.foods.createdBy, viewer)) : isNull(schema.foods.createdBy);
  const rows = await db.select().from(schema.foods).where(and(inArray(schema.foods.id, ids), visible));
  const found = rows.map((r) => r.id);
  if (found.length === 0) return new Map();
  const nutrients = await db.select().from(schema.foodNutrients).where(inArray(schema.foodNutrients.foodId, found));
  const portions = await db.select().from(schema.foodPortions).where(inArray(schema.foodPortions.foodId, found));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        source: r.source,
        name: r.name,
        brand: r.brand,
        barcode: r.barcode,
        basis: r.basis,
        nutrients: Object.fromEntries(nutrients.filter((n) => n.foodId === r.id).map((n) => [n.nutrient, n.amount])),
        portions: portions.filter((p) => p.foodId === r.id).map((p) => ({ label: p.label, amount: p.amount })),
      },
    ]),
  );
}

export async function foodByBarcode(barcode: string, viewer?: string): Promise<Food | null> {
  const [row] = await getDb()
    .select({ id: schema.foods.id })
    .from(schema.foods)
    .where(and(eq(schema.foods.barcode, barcode), viewer ? or(isNull(schema.foods.createdBy), eq(schema.foods.createdBy, viewer)) : isNull(schema.foods.createdBy)))
    .orderBy(sql`case when ${schema.foods.source} = 'custom' then 0 else 1 end`)
    .limit(1);
  return row ? ((await getFoods([row.id], viewer)).get(row.id) ?? null) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vitls/app test -- foods/store && pnpm --filter @vitls/app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/lib/foods/store.ts apps/app/server/lib/foods/store.test.ts
git commit -m "feat(app/nutrition): idempotent food store"
```

---

### Task 4: USDA FoodData Central parser

**Files:**
- Create: `apps/app/scripts/foods/usda.ts`, `apps/app/scripts/foods/usda.test.ts`, fixture dir `apps/app/scripts/foods/fixtures/usda/` with `food.csv`, `food_nutrient.csv`, `food_portion.csv`, `measure_unit.csv`
- Modify: `apps/app/package.json` (devDependency `csv-parse`)

**Interfaces:**
- Consumes: `ImportedFood` (Task 3).
- Produces: `parseUsda(dir: string, dataTypes?: string[]): ImportedFood[]`; `USDA_NUTRIENTS: Record<number, NutrientKey>`.

USDA FDC CSV facts (FoodData Central "Full Download" CSV, same layout for Foundation and SR Legacy):
`food.csv` → `fdc_id,data_type,description,food_category_id,publication_date`; `food_nutrient.csv` → `id,fdc_id,nutrient_id,amount,…`; `food_portion.csv` → `id,fdc_id,seq_num,amount,measure_unit_id,portion_description,modifier,gram_weight,…`; `measure_unit.csv` → `id,name`. Amounts are per 100 g. Nutrient ids: 1008 energy kcal (Foundation often lacks it — fall back to 2047 then 2048, Atwater kcal), 1003 protein, 1004 fat, 1258 saturated fat, 1005 carbs, 2000 sugars, 1079 fiber, 1093 sodium mg, 1092 potassium mg, 1253 cholesterol mg, 1087 calcium mg, 1089 iron mg, 1090 magnesium mg, 1162 vitamin C mg, 1114 vitamin D µg, 1057 caffeine mg, 1051 water g→ skip (water in food is not drinking water; do not map), 1018 alcohol g.

- [ ] **Step 1: Add the dependency and fixtures**

Run: `pnpm --filter @vitls/app add -D csv-parse`

`fixtures/usda/food.csv`:

```csv
"fdc_id","data_type","description","food_category_id","publication_date"
"748967","foundation_food","Eggs, Grade A, Large, egg whole","1","2019-12-16"
"171287","sr_legacy_food","Egg, whole, raw, fresh","1","2019-04-01"
"999999","branded_food","Some branded thing","","2020-01-01"
```

`fixtures/usda/food_nutrient.csv`:

```csv
"id","fdc_id","nutrient_id","amount"
"1","748967","2047","148"
"2","748967","1003","12.4"
"3","748967","1004","9.96"
"4","171287","1008","143"
"5","171287","1003","12.56"
"6","171287","1093","142"
"7","171287","1051","76.15"
"8","999999","1008","500"
```

`fixtures/usda/food_portion.csv`:

```csv
"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"
"1","171287","1","1","9999","","large","50"
"2","171287","2","1","1000","","cup (4.86 large eggs)","243"
```

`fixtures/usda/measure_unit.csv`:

```csv
"id","name"
"1000","cup"
"9999","undetermined"
```

- [ ] **Step 2: Write the failing test** — `usda.test.ts`

```ts
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseUsda } from "./usda";

const dir = fileURLToPath(new URL("./fixtures/usda", import.meta.url));

describe("parseUsda", () => {
  const foods = parseUsda(dir);

  it("keeps Foundation and SR Legacy, skips branded", () => {
    expect(foods.map((f) => f.sourceRef).sort()).toEqual(["171287", "748967"]);
  });

  it("maps nutrients and falls back to Atwater energy", () => {
    const foundation = foods.find((f) => f.sourceRef === "748967")!;
    expect(foundation).toMatchObject({ source: "usda", basis: "100g", name: "Eggs, Grade A, Large, egg whole" });
    expect(foundation.nutrients).toEqual({ energy: 148, protein: 12.4, fat: 9.96 });
    const legacy = foods.find((f) => f.sourceRef === "171287")!;
    expect(legacy.nutrients).toEqual({ energy: 143, protein: 12.56, sodium: 142 });
  });

  it("builds portion labels from unit/modifier", () => {
    const legacy = foods.find((f) => f.sourceRef === "171287")!;
    expect(legacy.portions).toEqual([
      { label: "1 large", amount: 50 },
      { label: "1 cup (4.86 large eggs)", amount: 243 },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- scripts/foods/usda`
Expected: FAIL — module `./usda` not found.

- [ ] **Step 4: Implement** — `apps/app/scripts/foods/usda.ts`

```ts
/**
 * USDA FoodData Central CSV (Foundation + SR Legacy, CC0) → ImportedFood. Amounts are per 100 g.
 * Download: https://fdc.nal.usda.gov/download-datasets (Full Download, CSV).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "csv-parse/sync";
import type { NutrientKey } from "@vitls/health-ingest";

import type { ImportedFood } from "../../server/lib/foods/store";

export const USDA_NUTRIENTS: Record<number, NutrientKey> = {
  1008: "energy",
  1003: "protein",
  1004: "fat",
  1258: "saturated_fat",
  1005: "carbs",
  2000: "sugars",
  1079: "fiber",
  1093: "sodium",
  1092: "potassium",
  1253: "cholesterol",
  1087: "calcium",
  1089: "iron",
  1090: "magnesium",
  1162: "vitamin_c",
  1114: "vitamin_d",
  1057: "caffeine",
  1018: "alcohol",
};
/** Atwater energy (kcal) used by Foundation foods that lack 1008. */
const ENERGY_FALLBACKS = [2047, 2048];

const read = (dir: string, file: string) =>
  parse(readFileSync(path.join(dir, file)), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];

export function parseUsda(dir: string, dataTypes = ["foundation_food", "sr_legacy_food"]): ImportedFood[] {
  const foods = read(dir, "food.csv").filter((f) => dataTypes.includes(f.data_type!));
  const wanted = new Set(foods.map((f) => f.fdc_id));
  const nutrients = new Map<string, Map<number, number>>();
  for (const n of read(dir, "food_nutrient.csv")) {
    if (!wanted.has(n.fdc_id)) continue;
    const amount = Number(n.amount);
    if (!Number.isFinite(amount)) continue;
    const per = nutrients.get(n.fdc_id!) ?? new Map<number, number>();
    per.set(Number(n.nutrient_id), amount);
    nutrients.set(n.fdc_id!, per);
  }
  const units = new Map(read(dir, "measure_unit.csv").map((u) => [u.id, u.name]));
  const portions = new Map<string, { label: string; amount: number }[]>();
  for (const p of read(dir, "food_portion.csv")) {
    if (!wanted.has(p.fdc_id)) continue;
    const grams = Number(p.gram_weight);
    if (!(grams > 0)) continue;
    const unit = units.get(p.measure_unit_id!);
    const what = [unit && unit !== "undetermined" ? unit : "", p.modifier, p.portion_description].filter(Boolean).join(" ").trim();
    if (!what) continue;
    const list = portions.get(p.fdc_id!) ?? [];
    list.push({ label: `${Number(p.amount) || 1} ${what}`, amount: grams });
    portions.set(p.fdc_id!, list);
  }
  return foods.map((f) => {
    const per = nutrients.get(f.fdc_id!) ?? new Map<number, number>();
    const mapped: Partial<Record<NutrientKey, number>> = {};
    for (const [id, key] of Object.entries(USDA_NUTRIENTS)) {
      const v = per.get(Number(id));
      if (v !== undefined) mapped[key] = v;
    }
    if (mapped.energy === undefined) {
      const fallback = ENERGY_FALLBACKS.map((id) => per.get(id)).find((v) => v !== undefined);
      if (fallback !== undefined) mapped.energy = fallback;
    }
    return { source: "usda", sourceRef: f.fdc_id!, name: f.description!, basis: "100g", nutrients: mapped, portions: portions.get(f.fdc_id!) ?? [] };
  });
}
```

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `pnpm --filter @vitls/app test -- scripts/foods/usda && pnpm --filter @vitls/app typecheck`
Expected: PASS.

```bash
git add apps/app/scripts/foods/usda.ts apps/app/scripts/foods/usda.test.ts apps/app/scripts/foods/fixtures/usda apps/app/package.json pnpm-lock.yaml
git commit -m "feat(app/nutrition): USDA FoodData Central parser"
```

---

### Task 5: CIQUAL and BLS parsers and the import CLI

**Files:**
- Create: `apps/app/scripts/foods/tabular.ts`, `apps/app/scripts/foods/ciqual.ts`, `apps/app/scripts/foods/bls.ts`, `apps/app/scripts/foods/tabular.test.ts`, `apps/app/scripts/foods-import.ts`
- Modify: `apps/app/package.json` (devDependency `exceljs`, script `foods:import`), `.gitignore` (`apps/app/.cache/`)

**Interfaces:**
- Consumes: `ImportedFood`, `upsertFoods` (Task 3), `parseUsda` (Task 4).
- Produces: `parseTabular(rows: Record<string, unknown>[], spec: TabularSpec): ImportedFood[]`; `readXlsx(file: string, sheet?: number): Promise<Record<string, unknown>[]>`; `CIQUAL_SPEC`, `BLS_SPEC: TabularSpec`; CLI `pnpm --filter @vitls/app foods:import [usda|ciqual|bls ...]`.

Both CIQUAL (xlsx, French headers like `Protéines, N x facteur de Jones (g/100 g)`, decimal comma, values `traces`, `< 0,5`, `-`) and BLS 4.0 (xlsx) are wide tables: one row per food, one column per constituent. One parser handles both, driven by header regexes; a header that matches no regex is ignored, and **the CLI aborts if a required nutrient (energy, protein, fat, carbs) matched no column**, so a renamed column in a future release fails loudly instead of importing zeros.

- [ ] **Step 1: Add dependency and write the failing test** — `tabular.test.ts`

Run: `pnpm --filter @vitls/app add -D exceljs`

```ts
import { describe, expect, it } from "vitest";

import { CIQUAL_SPEC } from "./ciqual";
import { parseTabular, toNumber } from "./tabular";

describe("tabular food tables", () => {
  it("parses French decimals, traces and bounds", () => {
    expect(toNumber("12,5")).toBe(12.5);
    expect(toNumber("traces")).toBe(0);
    expect(toNumber("< 0,5")).toBe(0.25);
    expect(toNumber("-")).toBeUndefined();
    expect(toNumber(7)).toBe(7);
  });

  it("maps CIQUAL columns by header", () => {
    const rows = [
      {
        alim_code: "22000",
        alim_nom_fr: "Œuf, cru",
        alim_nom_eng: "Egg, raw",
        "Energie, Règlement UE N° 1169/2011 (kcal/100 g)": "140",
        "Protéines, N x facteur de Jones (g/100 g)": "12,7",
        "Glucides (g/100 g)": "0,27",
        "Lipides (g/100 g)": "9,83",
        "Sodium (mg/100 g)": "130",
        "Eau (g/100 g)": "76",
      },
    ];
    const [egg] = parseTabular(rows, CIQUAL_SPEC);
    expect(egg).toMatchObject({ source: "ciqual", sourceRef: "22000", name: "Egg, raw", names: { fr: "Œuf, cru" }, basis: "100g" });
    expect(egg!.nutrients).toEqual({ energy: 140, protein: 12.7, carbs: 0.27, fat: 9.83, sodium: 130 });
  });

  it("reports required nutrients with no matching column", () => {
    expect(() => parseTabular([{ alim_code: "1", alim_nom_eng: "x" }], CIQUAL_SPEC)).toThrow(/energy, protein, fat, carbs/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- scripts/foods/tabular`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/app/scripts/foods/tabular.ts`:

```ts
/** Wide food composition tables (one row per food, one column per constituent), mapped by header regexes. */
import ExcelJS from "exceljs";
import type { NutrientKey } from "@vitls/health-ingest";

import type { FoodSource, ImportedFood } from "../../server/lib/foods/store";

export interface TabularSpec {
  source: FoodSource;
  id: string;
  name: string;
  /** Extra language columns: lang → column. */
  names?: Record<string, string>;
  /** Nutrient → header regex (first matching column wins). */
  columns: Partial<Record<NutrientKey, RegExp>>;
}

const REQUIRED: NutrientKey[] = ["energy", "protein", "fat", "carbs"];

/** "12,5" → 12.5; "traces" → 0; "< 0,5" → half the bound; "-" / "" → undefined. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "traces" || v === "tr") return 0;
  const bound = /^<\s*([\d.,]+)$/.exec(v);
  if (bound) return Number(bound[1]!.replace(",", ".")) / 2;
  const n = Number(v.replace(",", "."));
  return v && Number.isFinite(n) ? n : undefined;
}

export function parseTabular(rows: Record<string, unknown>[], spec: TabularSpec): ImportedFood[] {
  const headers = Object.keys(rows[0] ?? {});
  const mapping = Object.entries(spec.columns).flatMap(([key, re]) => {
    const header = headers.find((h) => re!.test(h));
    return header ? [[key as NutrientKey, header] as const] : [];
  });
  const missing = REQUIRED.filter((k) => !mapping.some(([key]) => key === k));
  if (missing.length) throw new Error(`${spec.source}: no column for ${missing.join(", ")} — check the header regexes against the file`);
  return rows.flatMap((row) => {
    const id = String(row[spec.id] ?? "").trim();
    const name = String(row[spec.name] ?? "").trim();
    if (!id || !name) return [];
    const nutrients: Partial<Record<NutrientKey, number>> = {};
    for (const [key, header] of mapping) {
      const v = toNumber(row[header]);
      if (v !== undefined) nutrients[key] = v;
    }
    const names = Object.fromEntries(
      Object.entries(spec.names ?? {}).flatMap(([lang, col]) => {
        const n = String(row[col] ?? "").trim();
        return n ? [[lang, n]] : [];
      }),
    );
    return [{ source: spec.source, sourceRef: id, name, names, basis: "100g" as const, nutrients }];
  });
}

/** First worksheet (or `sheet`) as objects keyed by the header row. */
export async function readXlsx(file: string, sheet = 1): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[sheet - 1];
  if (!ws) throw new Error(`${file}: no worksheet ${sheet}`);
  const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? "").trim());
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const values = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(header.map((h, j) => [h, (values[j] as { result?: unknown })?.result ?? values[j]])));
  });
  return rows;
}
```

`apps/app/scripts/foods/ciqual.ts`:

```ts
/** ANSES CIQUAL 2025 (Etalab Open License 2.0) — https://ciqual.anses.fr, xlsx "Table Ciqual 2025". Values per 100 g. */
import type { TabularSpec } from "./tabular";

export const CIQUAL_SPEC: TabularSpec = {
  source: "ciqual",
  id: "alim_code",
  name: "alim_nom_eng",
  names: { fr: "alim_nom_fr" },
  columns: {
    energy: /^Energie, Règlement UE N° 1169\/2011 \(kcal\/100 ?g\)/i,
    protein: /^Protéines, N x facteur de Jones \(g\/100 ?g\)/i,
    fat: /^Lipides \(g\/100 ?g\)/i,
    saturated_fat: /^AG saturés \(g\/100 ?g\)/i,
    carbs: /^Glucides \(g\/100 ?g\)/i,
    sugars: /^Sucres \(g\/100 ?g\)/i,
    fiber: /^Fibres alimentaires \(g\/100 ?g\)/i,
    sodium: /^Sodium \(mg\/100 ?g\)/i,
    potassium: /^Potassium \(mg\/100 ?g\)/i,
    cholesterol: /^Cholestérol \(mg\/100 ?g\)/i,
    calcium: /^Calcium \(mg\/100 ?g\)/i,
    iron: /^Fer \(mg\/100 ?g\)/i,
    magnesium: /^Magnésium \(mg\/100 ?g\)/i,
    vitamin_c: /^Vitamine C \(mg\/100 ?g\)/i,
    vitamin_d: /^Vitamine D \(µg\/100 ?g\)/i,
    alcohol: /^Alcool \(g\/100 ?g\)/i,
  },
};
```

`apps/app/scripts/foods/bls.ts` (BLS 4.0 uses EuroFIR-style component codes in its header row; confirm in Step 5):

```ts
/** Bundeslebensmittelschlüssel 4.0 (CC BY 4.0, Max Rubner-Institut) — xlsx. Values per 100 g. */
import type { TabularSpec } from "./tabular";

export const BLS_SPEC: TabularSpec = {
  source: "bls",
  id: "SBLS",
  name: "ST",
  names: { de: "ST" },
  columns: {
    energy: /^ENERCC\b|kcal/i,
    protein: /^PROT625\b|^Protein/i,
    fat: /^FAT\b|^Fett/i,
    saturated_fat: /^FASAT\b|gesättigte/i,
    carbs: /^CHO\b|^Kohlenhydrate/i,
    sugars: /^SUGAR\b|^Zucker/i,
    fiber: /^FIBT\b|^Ballaststoffe/i,
    sodium: /^NA\b|^Natrium/i,
    potassium: /^K\b|^Kalium/i,
    cholesterol: /^CHORL\b|^Cholesterin/i,
    calcium: /^CA\b|^Calcium/i,
    iron: /^FE\b|^Eisen/i,
    magnesium: /^MG\b|^Magnesium/i,
    vitamin_c: /^VITC\b|^Vitamin C/i,
    vitamin_d: /^VITD\b|^Vitamin D/i,
    alcohol: /^ALC\b|^Alkohol/i,
  },
};
```

`apps/app/scripts/foods-import.ts`:

```ts
/**
 * Imports open food composition tables into the shared food reference (docs/design/06-nutrition.md §2).
 *   pnpm --filter @vitls/app foods:import            # all sources found in .cache/foods
 *   pnpm --filter @vitls/app foods:import ciqual     # one source
 * Put the downloaded files in apps/app/.cache/foods/: usda/ (FDC CSV folder), ciqual.xlsx, bls.xlsx.
 * Requires DATABASE_URL (the dev Postgres or PGlite file) like the app.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { withMigrationRuntime } from "@agent-native/core/db";

import { runVitlsMigrations } from "../server/plugins/db";
import { upsertFoods, type ImportedFood } from "../server/lib/foods/store";
import { BLS_SPEC } from "./foods/bls";
import { CIQUAL_SPEC } from "./foods/ciqual";
import { parseTabular, readXlsx } from "./foods/tabular";
import { parseUsda } from "./foods/usda";

const cache = fileURLToPath(new URL("../.cache/foods/", import.meta.url));
const SOURCES: Record<string, { path: string; load: (p: string) => Promise<ImportedFood[]> }> = {
  usda: { path: `${cache}usda`, load: async (p) => parseUsda(p) },
  ciqual: { path: `${cache}ciqual.xlsx`, load: async (p) => parseTabular(await readXlsx(p), CIQUAL_SPEC) },
  bls: { path: `${cache}bls.xlsx`, load: async (p) => parseTabular(await readXlsx(p), BLS_SPEC) },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SOURCES);
await withMigrationRuntime(() => runVitlsMigrations(null));
for (const name of wanted) {
  const source = SOURCES[name];
  if (!source) throw new Error(`Unknown source "${name}" (usda, ciqual, bls)`);
  if (!existsSync(source.path)) {
    console.warn(`skip ${name}: ${source.path} not found`);
    continue;
  }
  const foods = await source.load(source.path);
  const result = await upsertFoods(foods);
  console.log(`${name}: ${foods.length} foods (${result.inserted} new, ${result.updated} updated)`);
}
```

`apps/app/package.json` scripts: `"foods:import": "tsx scripts/foods-import.ts"`. Root `package.json`: add alias `"foods:import": "pnpm --filter @vitls/app foods:import"` next to the other app aliases. `.gitignore`: add `apps/app/.cache/`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vitls/app test -- scripts/foods && pnpm --filter @vitls/app typecheck`
Expected: PASS.

- [ ] **Step 5: Verify against the real files (manual, required)**

Download into `apps/app/.cache/foods/`: FDC Foundation + SR Legacy CSV (unzip into `usda/`, merge both folders' `food*.csv` or run the importer once per folder), CIQUAL 2025 xlsx (Recherche Data Gouv, DOI 10.57745/RDMHWY) as `ciqual.xlsx`, BLS 4.0 xlsx as `bls.xlsx`. Then run against the dev database:

Run: `pnpm foods:import`
Expected: three lines with counts in the thousands (USDA ~8k, CIQUAL ~3.5k, BLS ~7k) and no "no column for" error. If a source throws "no column for …", open the xlsx header row, correct that source's regex in `ciqual.ts`/`bls.ts`, add the real header string to `tabular.test.ts`, re-run. Spot-check: `psql` → `SELECT f.name, n.nutrient, n.amount FROM foods f JOIN food_nutrients n ON n.food_id=f.id WHERE f.source='ciqual' AND f.name ILIKE 'egg%' LIMIT 10;` shows ~12–13 g protein per 100 g.

- [ ] **Step 6: Commit**

```bash
git add apps/app/scripts/foods/tabular.ts apps/app/scripts/foods/ciqual.ts apps/app/scripts/foods/bls.ts apps/app/scripts/foods/tabular.test.ts apps/app/scripts/foods-import.ts apps/app/package.json package.json pnpm-lock.yaml .gitignore
git commit -m "feat(app/nutrition): CIQUAL and BLS parsers and foods:import CLI"
```

---

### Task 6: Food search, Open Food Facts and `search-foods`

**Files:**
- Create: `apps/app/server/lib/foods/search.ts`, `apps/app/server/lib/foods/off.ts`, `apps/app/server/lib/foods/search.test.ts`, `apps/app/server/lib/foods/fixtures/off-product.json`, `apps/app/actions/search-foods.ts`

**Interfaces:**
- Consumes: `upsertFoods`, `getFoods`, `foodByBarcode`, `searchKey`.
- Produces:

```ts
export type OffFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
export function offProduct(barcode: string, fetcher?: OffFetch): Promise<ImportedFood | null>;
export function offSearch(query: string, fetcher?: OffFetch): Promise<ImportedFood[]>;
export function searchFoods(input: { query?: string; barcode?: string; viewer: string; limit?: number; fetcher?: OffFetch }): Promise<Food[]>;
```

- [ ] **Step 1: Write the fixture and failing test**

`fixtures/off-product.json` (trimmed real shape of `GET /api/v2/product/{code}.json`):

```json
{
  "code": "8594001234567",
  "status": 1,
  "product": {
    "product_name": "Tvaroh polotučný",
    "brands": "Madeta",
    "serving_quantity": 250,
    "nutriments": {
      "energy-kcal_100g": 121,
      "proteins_100g": 12.5,
      "fat_100g": 5,
      "saturated-fat_100g": 3.2,
      "carbohydrates_100g": 3.9,
      "sugars_100g": 3.9,
      "fiber_100g": 0,
      "salt_100g": 0.1
    }
  }
}
```

`search.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { offProduct, type OffFetch } from "./off";
import { searchFoods } from "./search";
import { upsertFoods } from "./store";

const product = JSON.parse(readFileSync(new URL("./fixtures/off-product.json", import.meta.url), "utf8"));
const offOk: OffFetch = async () => ({ ok: true, json: async () => product });
const offDown: OffFetch = (_url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

describe("food search", () => {
  beforeAll(async () => {
    await setupTestDb();
    await upsertFoods([
      { source: "ciqual", sourceRef: "1", name: "Quark, half-fat", names: { sk: "Tvaroh polotučný" }, basis: "100g", nutrients: { protein: 11 } },
      { source: "usda", sourceRef: "2", name: "Cheese, cottage, lowfat", basis: "100g", nutrients: { protein: 12 } },
      { source: "usda", sourceRef: "3", name: "Chicken breast, roasted", basis: "100g", nutrients: { protein: 31 } },
      { source: "custom", sourceRef: "c1", name: "Mia's protein pancakes", basis: "100g", nutrients: { protein: 20 }, createdBy: "mia@example.com" },
    ]);
  });

  it("matches Slovak names without diacritics and ranks prefix matches first", async () => {
    const results = await searchFoods({ query: "tvaroh polotucny", viewer: "x@example.com", fetcher: offDown });
    expect(results[0]?.name).toBe("Quark, half-fat");
  });

  it("finds by any token and shows custom foods only to their author", async () => {
    expect((await searchFoods({ query: "chicken", viewer: "x@example.com", fetcher: offDown }))[0]?.name).toBe("Chicken breast, roasted");
    expect(await searchFoods({ query: "pancakes", viewer: "x@example.com", fetcher: offDown })).toEqual([]);
    expect((await searchFoods({ query: "pancakes", viewer: "mia@example.com", fetcher: offDown }))[0]?.source).toBe("custom");
  });

  it("maps an Open Food Facts product (salt → sodium) and caches it by barcode", async () => {
    const mapped = await offProduct("8594001234567", offOk);
    expect(mapped).toMatchObject({ source: "off", barcode: "8594001234567", brand: "Madeta", portions: [{ label: "1 serving", amount: 250 }] });
    expect(mapped!.nutrients).toMatchObject({ energy: 121, protein: 12.5, sodium: 40 });
    const [first] = await searchFoods({ barcode: "8594001234567", viewer: "x@example.com", fetcher: offOk });
    const [cached] = await searchFoods({ barcode: "8594001234567", viewer: "x@example.com", fetcher: offDown });
    expect(cached?.id).toBe(first?.id);
  });

  it("returns local results when Open Food Facts is down (Review Focus 5)", async () => {
    const started = Date.now();
    const results = await searchFoods({ query: "cottage", viewer: "x@example.com", fetcher: offDown });
    expect(results[0]?.name).toBe("Cheese, cottage, lowfat");
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- foods/search`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/app/server/lib/foods/off.ts`:

```ts
/**
 * Open Food Facts (ODbL): on-demand barcode and text lookups; results are cached per product through upsertFoods.
 * Never import a full dump (that would make our derived database ODbL). https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
import type { NutrientKey } from "@vitls/health-ingest";

import type { ImportedFood } from "./store";

export type OffFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const BASE = "https://world.openfoodfacts.org";
const HEADERS = { "User-Agent": "VITLS/0.1 (https://vitls.ai)" };
const TIMEOUT_MS = 3000;
const FIELDS = "code,product_name,brands,serving_quantity,nutriments";

/** OFF nutriment (per 100 g, in grams unless noted) → our key and factor to our unit. */
const OFF_NUTRIENTS: [string, NutrientKey, number][] = [
  ["energy-kcal_100g", "energy", 1],
  ["proteins_100g", "protein", 1],
  ["fat_100g", "fat", 1],
  ["saturated-fat_100g", "saturated_fat", 1],
  ["carbohydrates_100g", "carbs", 1],
  ["sugars_100g", "sugars", 1],
  ["fiber_100g", "fiber", 1],
  ["sodium_100g", "sodium", 1000],
  ["potassium_100g", "potassium", 1000],
  ["cholesterol_100g", "cholesterol", 1000],
  ["calcium_100g", "calcium", 1000],
  ["iron_100g", "iron", 1000],
  ["magnesium_100g", "magnesium", 1000],
  ["vitamin-c_100g", "vitamin_c", 1000],
  ["vitamin-d_100g", "vitamin_d", 1_000_000],
  ["caffeine_100g", "caffeine", 1000],
];

type OffProduct = { code?: string; product_name?: string; brands?: string; serving_quantity?: number; nutriments?: Record<string, unknown> };

async function getJson(url: string, fetcher: OffFetch): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { headers: HEADERS, signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toFood(p: OffProduct): ImportedFood | null {
  if (!p.code || !p.product_name?.trim()) return null;
  const n = p.nutriments ?? {};
  const nutrients: Partial<Record<NutrientKey, number>> = {};
  for (const [field, key, factor] of OFF_NUTRIENTS) {
    const v = Number(n[field]);
    if (n[field] !== undefined && Number.isFinite(v)) nutrients[key] = v * factor;
  }
  // Labels give salt, not sodium: sodium = salt / 2.5.
  if (nutrients.sodium === undefined && Number.isFinite(Number(n["salt_100g"]))) nutrients.sodium = (Number(n["salt_100g"]) / 2.5) * 1000;
  if (nutrients.energy === undefined) return null;
  return {
    source: "off",
    sourceRef: p.code,
    barcode: p.code,
    name: p.product_name.trim(),
    brand: p.brands?.split(",")[0]?.trim() || undefined,
    basis: "100g",
    nutrients,
    portions: Number(p.serving_quantity) > 0 ? [{ label: "1 serving", amount: Number(p.serving_quantity) }] : [],
  };
}

export async function offProduct(barcode: string, fetcher: OffFetch = fetch as unknown as OffFetch): Promise<ImportedFood | null> {
  const body = (await getJson(`${BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, fetcher)) as { status?: number; product?: OffProduct; code?: string } | null;
  return body?.status === 1 && body.product ? toFood({ ...body.product, code: body.product.code ?? body.code }) : null;
}

export async function offSearch(query: string, fetcher: OffFetch = fetch as unknown as OffFetch): Promise<ImportedFood[]> {
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10&fields=${FIELDS}`;
  const body = (await getJson(url, fetcher)) as { products?: OffProduct[] } | null;
  return (body?.products ?? []).flatMap((p) => toFood(p) ?? []);
}
```

`apps/app/server/lib/foods/search.ts`:

```ts
/**
 * Food search (docs/design/06-nutrition.md §5): local database first (any language, diacritics-insensitive),
 * Open Food Facts for unmatched barcodes and when local results are thin; OFF hits are cached.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";
import { searchKey } from "./normalize";
import { offProduct, offSearch, type OffFetch } from "./off";
import { foodByBarcode, getFoods, upsertFoods, type Food } from "./store";

const SOURCE_RANK: Record<string, number> = { custom: 0, ciqual: 1, bls: 2, usda: 3, off: 4 };
const OFF_REFRESH_MS = 90 * 86_400_000;

function score(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  const words = name.split(" ");
  const tokens = query.split(" ");
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  return 3;
}

async function localSearch(query: string, viewer: string, limit: number): Promise<Food[]> {
  const key = searchKey(query);
  const tokens = key.split(" ").filter(Boolean).slice(0, 6);
  if (tokens.length === 0) return [];
  const db = getDb();
  const n = schema.foodNames;
  const f = schema.foods;
  const rows = await db
    .select({ id: n.foodId, searchName: n.searchName, source: f.source })
    .from(n)
    .innerJoin(f, eq(f.id, n.foodId))
    .where(and(...tokens.map((t) => sql`${n.searchName} LIKE ${`%${t}%`}`), or(isNull(f.createdBy), eq(f.createdBy, viewer))))
    .limit(300);
  const best = new Map<string, { score: number; source: string; length: number }>();
  for (const r of rows) {
    const s = { score: score(r.searchName, key), source: r.source, length: r.searchName.length };
    const prev = best.get(r.id);
    if (!prev || s.score < prev.score) best.set(r.id, s);
  }
  const ids = [...best.entries()]
    .sort(([, a], [, b]) => a.score - b.score || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) || a.length - b.length)
    .slice(0, limit)
    .map(([id]) => id);
  const foods = await getFoods(ids, viewer);
  return ids.flatMap((id) => foods.get(id) ?? []);
}

export async function searchFoods(input: { query?: string; barcode?: string; viewer: string; limit?: number; fetcher?: OffFetch }): Promise<Food[]> {
  const limit = Math.min(input.limit ?? 10, 25);
  if (input.barcode) {
    const cached = await foodByBarcode(input.barcode, input.viewer);
    const fresh = cached && (cached.source !== "off" || (await isFresh(cached.id)));
    if (cached && fresh) return [cached];
    const remote = await offProduct(input.barcode, input.fetcher);
    if (!remote) return cached ? [cached] : [];
    const { ids } = await upsertFoods([remote]);
    return [...(await getFoods(ids, input.viewer)).values()];
  }
  const local = input.query ? await localSearch(input.query, input.viewer, limit) : [];
  if (local.length >= 3 || !input.query) return local;
  const remote = await offSearch(input.query, input.fetcher);
  if (remote.length === 0) return local;
  const { ids } = await upsertFoods(remote);
  const cached = await getFoods(ids, input.viewer);
  return [...local, ...ids.flatMap((id) => cached.get(id) ?? [])].slice(0, limit);
}

async function isFresh(foodId: string): Promise<boolean> {
  const [row] = await getDb().select({ refreshedAt: schema.foods.refreshedAt }).from(schema.foods).where(inArray(schema.foods.id, [foodId]));
  return !!row && Date.now() - Date.parse(row.refreshedAt) < OFF_REFRESH_MS;
}
```

`apps/app/actions/search-foods.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { searchFoods } from "../server/lib/foods/search";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Search the food database by name (any language; English works best for generic foods) or by barcode. Returns foods with nutrients per 100 g/ml (energy kcal, protein/fat/carbs/fiber/sugars g, sodium mg, …) and named portions. Use it for every item before log-meal; pick the closest generic food, or a branded product when the user names the brand.",
  schema: z.object({
    query: z.string().trim().min(2).max(120).optional(),
    barcode: z.string().regex(/^\d{8,14}$/).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }).refine((v) => v.query || v.barcode, "Pass query or barcode"),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, barcode, limit }, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    const foods = await searchFoods({ query, barcode, viewer: userEmail, limit });
    return { foods: foods.map(({ id, name, brand, source, basis, nutrients, portions }) => ({ id, name, brand, source, basis, nutrients, portions })) };
  },
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vitls/app test -- foods/search && pnpm --filter @vitls/app typecheck`
Expected: PASS. Then `pnpm --filter @vitls/app action search-foods --query "chicken breast"` against the dev DB after Task 5's import returns USDA/CIQUAL hits.

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/lib/foods/search.ts apps/app/server/lib/foods/off.ts apps/app/server/lib/foods/search.test.ts apps/app/server/lib/foods/fixtures/off-product.json apps/app/actions/search-foods.ts
git commit -m "feat(app/nutrition): food search with Open Food Facts fallback"
```

---

### Task 7: Meals and daily intake

**Files:**
- Create: `apps/app/shared/meals.ts`, `apps/app/server/lib/meals/intake.ts`, `apps/app/server/lib/meals/meals.ts`, `apps/app/server/lib/meals/meals.test.ts`

**Interfaces:**
- Consumes: `getFoods`, `upsertFoods` (custom food), `getCoachProfile(email).profile.timezone`, `NUTRIENTS`, `intakeMetric`.
- Produces (`shared/meals.ts`):

```ts
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;
export interface MealItemView { id: string; foodId: string | null; name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated: boolean }
export interface MealView { id: string; eatenAt: string; localDate: string; mealType: MealType | null; note: string | null; entry: string; source: string; items: MealItemView[]; totals: Nutrients }
export type MealItemInput =
  | { foodId: string; amount: number; unit?: "g" | "ml"; portion?: string }   // portion → amount × portion size
  | { name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated?: boolean }; // totals for this amount
export interface LogMealInput { mealId?: string; fromMealId?: string; eatenAt?: string; mealType?: MealType | null; note?: string; entry?: "photo" | "barcode" | "search" | "manual" | "copy"; items?: MealItemInput[] }
```

- `server/lib/meals/meals.ts`: `logMeal(owner: OwnerScope, input: LogMealInput): Promise<MealView>`, `deleteMeal(owner, mealId): Promise<{ deleted: boolean }>`, `listMeals(owner, { from, to }): Promise<MealView[]>`, `createFood(owner, food: Omit<ImportedFood, "source" | "sourceRef" | "createdBy">): Promise<Food>`.
- `server/lib/meals/intake.ts`: `recomputeIntakeDay(owner: OwnerScope, localDate: string): Promise<Nutrients>`.

- [ ] **Step 1: Write the failing test** — `meals.test.ts`

```ts
import { mutateUserSetting } from "@agent-native/core/settings";
import { beforeAll, describe, expect, it } from "vitest";

import { getHealth } from "../health/read";
import { upsertFoods } from "../foods/store";
import { setupTestDb } from "../../test/db";
import { deleteMeal, listMeals, logMeal } from "./meals";

const mia = { userEmail: "mia@example.com", orgId: "org_mia" };
const eve = { userEmail: "eve@example.com", orgId: "org_eve" };
let eggId = "";
let oilId = "";

const intake = async (owner: typeof mia, day: string) =>
  (await getHealth(owner.userEmail, { from: day, to: day, include: ["daily"] })).daily ?? {};

describe("meals", () => {
  beforeAll(async () => {
    await setupTestDb();
    await mutateUserSetting(mia.userEmail, "vitls-coach", () => ({ timezone: "Europe/Prague" }));
    const { ids } = await upsertFoods([
      { source: "usda", sourceRef: "egg", name: "Egg, whole", basis: "100g", nutrients: { energy: 143, protein: 12.6, fat: 9.5 }, portions: [{ label: "1 large", amount: 50 }] },
      { source: "usda", sourceRef: "oil", name: "Olive oil", basis: "100ml", nutrients: { energy: 824, fat: 91.6 } },
    ]);
    [eggId, oilId] = ids as [string, string];
  });

  it("logs items from grams and portions with snapshots and day totals", async () => {
    const meal = await logMeal(mia, {
      eatenAt: "2026-10-05T07:30:00+02:00",
      mealType: "breakfast",
      items: [
        { foodId: eggId, amount: 2, portion: "1 large" },
        { foodId: oilId, amount: 10, unit: "ml" },
        { name: "Toast", amount: 30, unit: "g", nutrients: { energy: 80, protein: 3, carbs: 15 }, estimated: true },
      ],
    });
    expect(meal.localDate).toBe("2026-10-05");
    expect(meal.items.map((i) => [i.amount, i.unit])).toEqual([[100, "g"], [10, "ml"], [30, "g"]]);
    expect(meal.totals.protein).toBeCloseTo(15.6);
    expect(meal.totals.energy).toBeCloseTo(143 + 82.4 + 80);
    const daily = await intake(mia, "2026-10-05");
    expect(daily.intake_protein?.values[0]).toMatchObject({ date: "2026-10-05", source: "vitls" });
    expect(daily.intake_protein?.values[0]?.value).toBeCloseTo(15.6);
  });

  it("puts a meal at 00:30 local time on that local day (Review Focus 1)", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-06T00:30:00+02:00", items: [{ foodId: eggId, amount: 50 }] });
    expect(meal.localDate).toBe("2026-10-06");
  });

  it("keeps the snapshot when the reference food changes", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-04T12:00:00Z", items: [{ foodId: eggId, amount: 100 }] });
    await upsertFoods([{ source: "usda", sourceRef: "egg", name: "Egg, whole", basis: "100g", nutrients: { energy: 999, protein: 99 } }]);
    const [again] = await listMeals(mia, { from: "2026-10-04", to: "2026-10-04" });
    expect(again?.items[0]?.nutrients.protein).toBeCloseTo(12.6);
    expect(again?.id).toBe(meal.id);
  });

  it("recomputes both days when a meal moves and after delete (Review Focus 2)", async () => {
    const meal = await logMeal(mia, { eatenAt: "2026-10-01T12:00:00Z", items: [{ name: "Skyr", amount: 150, unit: "g", nutrients: { protein: 16 } }] });
    await logMeal(mia, { mealId: meal.id, eatenAt: "2026-10-02T12:00:00Z" });
    expect((await intake(mia, "2026-10-01")).intake_protein).toBeUndefined();
    expect((await intake(mia, "2026-10-02")).intake_protein?.values[0]?.value).toBe(16);
    await deleteMeal(mia, meal.id);
    expect((await intake(mia, "2026-10-02")).intake_protein).toBeUndefined();
  });

  it("never produces NaN when a food lacks a nutrient (Review Focus 3)", async () => {
    await logMeal(mia, { eatenAt: "2026-09-30T12:00:00Z", items: [{ foodId: oilId, amount: 10, unit: "ml" }, { name: "Apple", amount: 150, unit: "g", nutrients: { fiber: 3.6 } }] });
    const daily = await intake(mia, "2026-09-30");
    expect(daily.intake_fiber?.values[0]?.value).toBe(3.6);
    expect(daily.intake_fat?.values[0]?.value).toBeCloseTo(9.16);
    for (const entry of Object.values(daily)) for (const v of entry.values) expect(Number.isNaN(v.value)).toBe(false);
  });

  it("rejects unit mismatches and unknown portions without writing (Review Focus 4)", async () => {
    await expect(logMeal(mia, { eatenAt: "2026-09-29T12:00:00Z", items: [{ foodId: eggId, amount: 100, unit: "ml" }] })).rejects.toThrow(/Egg, whole.*per 100 g/);
    await expect(logMeal(mia, { eatenAt: "2026-09-29T12:00:00Z", items: [{ foodId: eggId, amount: 1, portion: "1 cup" }] })).rejects.toThrow(/portion "1 cup"/);
    expect(await listMeals(mia, { from: "2026-09-29", to: "2026-09-29" })).toEqual([]);
  });

  it("copies a meal to now and isolates owners", async () => {
    const [source] = await listMeals(mia, { from: "2026-10-05", to: "2026-10-05" });
    const copy = await logMeal(mia, { fromMealId: source!.id, eatenAt: "2026-10-07T07:30:00+02:00" });
    expect(copy).toMatchObject({ entry: "copy", localDate: "2026-10-07" });
    expect(copy.items).toHaveLength(3);
    await expect(logMeal(eve, { mealId: source!.id, note: "mine" })).rejects.toThrow(/not found/i);
    await expect(logMeal(eve, { fromMealId: source!.id })).rejects.toThrow(/not found/i);
    expect(await deleteMeal(eve, source!.id)).toEqual({ deleted: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- meals/meals`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/app/shared/meals.ts`:

```ts
/** Meal types shared by actions and UI (docs/design/06-nutrition.md §3). meal_type = the HealthKit / Health Connect enum. */
import type { NutrientKey } from "@vitls/health-ingest";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;

export interface MealItemView {
  id: string;
  foodId: string | null;
  name: string;
  amount: number;
  unit: "g" | "ml";
  nutrients: Nutrients;
  estimated: boolean;
}

export interface MealView {
  id: string;
  eatenAt: string;
  localDate: string;
  mealType: MealType | null;
  note: string | null;
  entry: string;
  source: string;
  items: MealItemView[];
  totals: Nutrients;
}

export type MealItemInput =
  | { foodId: string; amount: number; unit?: "g" | "ml"; portion?: string }
  | { name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated?: boolean };

export interface LogMealInput {
  mealId?: string;
  fromMealId?: string;
  eatenAt?: string;
  mealType?: MealType | null;
  note?: string;
  entry?: "photo" | "barcode" | "search" | "manual" | "copy";
  items?: MealItemInput[];
}

/** Sums nutrient maps, skipping missing and non-finite values. */
export function sumNutrients(list: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const n of list) {
    for (const [k, v] of Object.entries(n) as [NutrientKey, number][]) {
      if (Number.isFinite(v)) out[k] = Math.round(((out[k] ?? 0) + v) * 100) / 100;
    }
  }
  return out;
}
```

`apps/app/server/lib/meals/intake.ts`:

```ts
/**
 * Daily intake = plain daily metrics (intake_<nutrient>) under a per-user "vitls/food" source, recomputed from the
 * day's meals on every write (docs/design/06-nutrition.md §3). Charts, widgets and get-health trends need no new code.
 */
import { randomUUID } from "node:crypto";

import { intakeMetric, NUTRIENTS } from "@vitls/health-ingest";
import { and, eq, inArray, like } from "drizzle-orm";

import { sumNutrients, type Nutrients } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import type { OwnerScope } from "../ingest/devices";

const FOOD = { provider: "vitls", via: "food", deviceTokenId: "food" } as const;

export async function foodSourceId(owner: OwnerScope): Promise<string> {
  const db = getDb();
  await db
    .insert(schema.healthSources)
    .values({ id: randomUUID(), ...FOOD, label: "Food log", createdAt: new Date().toISOString(), ownerEmail: owner.userEmail, orgId: owner.orgId })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: schema.healthSources.id })
    .from(schema.healthSources)
    .where(and(eq(schema.healthSources.ownerEmail, owner.userEmail), eq(schema.healthSources.deviceTokenId, FOOD.deviceTokenId), eq(schema.healthSources.provider, FOOD.provider), eq(schema.healthSources.via, FOOD.via)));
  return row!.id;
}

export async function recomputeIntakeDay(owner: OwnerScope, localDate: string): Promise<Nutrients> {
  const db = getDb();
  const mealIds = (
    await db
      .select({ id: schema.meals.id })
      .from(schema.meals)
      .where(and(eq(schema.meals.ownerEmail, owner.userEmail), eq(schema.meals.localDate, localDate), eq(schema.meals.source, "vitls")))
  ).map((m) => m.id);
  const items = mealIds.length
    ? await db.select({ nutrients: schema.mealItems.nutrients }).from(schema.mealItems).where(and(eq(schema.mealItems.ownerEmail, owner.userEmail), inArray(schema.mealItems.mealId, mealIds)))
    : [];
  const totals = sumNutrients(items.map((i) => JSON.parse(i.nutrients) as Nutrients));
  const sourceId = await foodSourceId(owner);
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.dailyMetrics)
      .where(and(eq(schema.dailyMetrics.ownerEmail, owner.userEmail), eq(schema.dailyMetrics.sourceId, sourceId), eq(schema.dailyMetrics.day, localDate), like(schema.dailyMetrics.metric, "intake_%")));
    const rows = NUTRIENTS.flatMap((n) =>
      totals[n.key] === undefined ? [] : [{ sourceId, day: localDate, metric: intakeMetric(n.key), value: totals[n.key]!, unit: n.unit, updatedAt: now, ownerEmail: owner.userEmail, orgId: owner.orgId, visibility: "private" as const }],
    );
    if (rows.length) await tx.insert(schema.dailyMetrics).values(rows);
  });
  return totals;
}
```

`apps/app/server/lib/meals/meals.ts`:

```ts
/**
 * Food log (docs/design/06-nutrition.md §3, §5). Items carry a nutrient snapshot for the eaten amount; every write
 * recomputes the affected days' intake metrics. Owner-scoped: another user's meal id behaves as "not found".
 */
import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { recordChange, runWithRequestContext } from "@agent-native/core/server";
import type { NutrientKey } from "@vitls/health-ingest";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { sumNutrients, type LogMealInput, type MealItemInput, type MealView, type Nutrients } from "../../../shared/meals";
import { getDb, schema } from "../../db";
import { getCoachProfile } from "../coach/profile";
import { getFoods, upsertFoods, type Food, type ImportedFood } from "../foods/store";
import type { OwnerScope } from "../ingest/devices";
import { recomputeIntakeDay } from "./intake";

const MAX_ITEMS = 40;

const localDateOf = (at: Date, timezone: string) => at.toLocaleDateString("en-CA", { timeZone: timezone });

function scale(per: Nutrients, amount: number): Nutrients {
  return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(((v as number) * amount) / 100 * 100) / 100])) as Nutrients;
}

type ResolvedItem = { foodId: string | null; name: string; amount: number; unit: "g" | "ml"; nutrients: Nutrients; estimated: boolean };

function resolveItem(item: MealItemInput, foods: Map<string, Food>): ResolvedItem {
  if ("foodId" in item) {
    const food = foods.get(item.foodId);
    if (!food) fail(`Food ${item.foodId} not found — search-foods first`, { statusCode: 400, errorCode: "food_not_found" });
    const basisUnit = food.basis === "100ml" ? "ml" : "g";
    let amount = item.amount;
    if (item.portion) {
      const portion = food.portions.find((p) => p.label === item.portion);
      if (!portion) fail(`${food.name} has no portion "${item.portion}" (has: ${food.portions.map((p) => p.label).join(", ") || "none"})`, { statusCode: 400, errorCode: "unknown_portion" });
      amount = item.amount * portion.amount;
    } else if (item.unit && item.unit !== basisUnit) {
      fail(`${food.name} is measured per 100 ${basisUnit}; give the amount in ${basisUnit}`, { statusCode: 400, errorCode: "unit_mismatch" });
    }
    if (!(amount > 0 && amount <= 10_000)) fail(`Amount for ${food.name} must be between 0 and 10 kg`, { statusCode: 400, errorCode: "invalid_amount" });
    return { foodId: food.id, name: food.brand ? `${food.name} (${food.brand})` : food.name, amount: Math.round(amount * 10) / 10, unit: basisUnit, nutrients: scale(food.nutrients, amount), estimated: false };
  }
  if (!(item.amount > 0 && item.amount <= 10_000)) fail(`Amount for ${item.name} must be between 0 and 10 kg`, { statusCode: 400, errorCode: "invalid_amount" });
  const nutrients = Object.fromEntries(Object.entries(item.nutrients).filter(([, v]) => Number.isFinite(v) && (v as number) >= 0)) as Nutrients;
  return { foodId: null, name: item.name.trim().slice(0, 120), amount: item.amount, unit: item.unit, nutrients, estimated: item.estimated ?? true };
}

async function ownedMeal(owner: OwnerScope, mealId: string) {
  const [meal] = await getDb().select().from(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, owner.userEmail)));
  if (!meal) fail("Meal not found", { statusCode: 404, errorCode: "meal_not_found" });
  return meal;
}

async function itemsOf(owner: OwnerScope, mealIds: string[]) {
  if (mealIds.length === 0) return [];
  return getDb()
    .select()
    .from(schema.mealItems)
    .where(and(eq(schema.mealItems.ownerEmail, owner.userEmail), inArray(schema.mealItems.mealId, mealIds)))
    .orderBy(asc(schema.mealItems.position));
}

function toView(meal: typeof schema.meals.$inferSelect, items: (typeof schema.mealItems.$inferSelect)[]): MealView {
  const views = items.map((i) => ({ id: i.id, foodId: i.foodId, name: i.name ?? "", amount: i.amount, unit: i.unit, nutrients: JSON.parse(i.nutrients) as Nutrients, estimated: i.estimated === 1 }));
  return {
    id: meal.id,
    eatenAt: meal.eatenAt.toISOString(),
    localDate: meal.localDate,
    mealType: meal.mealType ?? null,
    note: meal.note ?? null,
    entry: meal.entry,
    source: meal.source,
    items: views,
    totals: sumNutrients(views.map((v) => v.nutrients)),
  };
}

export async function logMeal(owner: OwnerScope, input: LogMealInput): Promise<MealView> {
  return runWithRequestContext({ userEmail: owner.userEmail, orgId: owner.orgId ?? undefined }, async () => {
    const db = getDb();
    const { profile } = await getCoachProfile(owner.userEmail);
    const timezone = profile.timezone ?? "UTC";
    const existing = input.mealId ? await ownedMeal(owner, input.mealId) : null;
    const template = input.fromMealId ? await ownedMeal(owner, input.fromMealId) : null;

    let items: ResolvedItem[] | null = null;
    if (input.items) {
      if (input.items.length === 0 || input.items.length > MAX_ITEMS) fail(`A meal needs 1–${MAX_ITEMS} items`, { statusCode: 400, errorCode: "invalid_items" });
      const foodIds = input.items.flatMap((i) => ("foodId" in i ? [i.foodId] : []));
      const foods = await getFoods([...new Set(foodIds)], owner.userEmail);
      items = input.items.map((i) => resolveItem(i, foods));
    } else if (template) {
      items = (await itemsOf(owner, [template.id])).map((i) => ({ foodId: i.foodId, name: i.name ?? "", amount: i.amount, unit: i.unit, nutrients: JSON.parse(i.nutrients) as Nutrients, estimated: i.estimated === 1 }));
    } else if (!existing) {
      fail("Give items or fromMealId", { statusCode: 400, errorCode: "invalid_items" });
    }

    const eatenAt = input.eatenAt ? new Date(input.eatenAt) : existing?.eatenAt ?? new Date();
    if (Number.isNaN(eatenAt.getTime())) fail("eatenAt must be an ISO timestamp", { statusCode: 400, errorCode: "invalid_time" });
    const localDate = localDateOf(eatenAt, timezone);
    const now = new Date().toISOString();
    const id = existing?.id ?? randomUUID();
    const owned = { ownerEmail: owner.userEmail, orgId: owner.orgId, visibility: "private" as const };

    await db.transaction(async (tx) => {
      const values = {
        eatenAt,
        localDate,
        mealType: input.mealType !== undefined ? input.mealType : (existing?.mealType ?? template?.mealType ?? null),
        note: input.note !== undefined ? input.note : (existing?.note ?? null),
        updatedAt: now,
      };
      if (existing) {
        await tx.update(schema.meals).set(values).where(and(eq(schema.meals.id, id), eq(schema.meals.ownerEmail, owner.userEmail)));
      } else {
        await tx.insert(schema.meals).values({ id, ...values, entry: template ? "copy" : (input.entry ?? "manual"), source: "vitls", createdAt: now, ...owned });
      }
      if (items) {
        await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, id), eq(schema.mealItems.ownerEmail, owner.userEmail)));
        await tx.insert(schema.mealItems).values(
          items.map((item, position) => ({ id: randomUUID(), mealId: id, position, foodId: item.foodId, name: item.name, amount: item.amount, unit: item.unit, nutrients: JSON.stringify(item.nutrients), estimated: item.estimated ? 1 : 0, ...owned })),
        );
      }
    });

    for (const day of new Set([localDate, existing?.localDate].filter((d): d is string => !!d))) await recomputeIntakeDay(owner, day);
    recordChange({ source: "health", type: "meal", key: id, owner: owner.userEmail, orgId: owner.orgId ?? undefined });
    const [meal] = await db.select().from(schema.meals).where(eq(schema.meals.id, id));
    return toView(meal!, await itemsOf(owner, [id]));
  });
}

export async function deleteMeal(owner: OwnerScope, mealId: string): Promise<{ deleted: boolean }> {
  const db = getDb();
  const [meal] = await db.select().from(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, owner.userEmail)));
  if (!meal) return { deleted: false };
  await db.transaction(async (tx) => {
    await tx.delete(schema.mealItems).where(and(eq(schema.mealItems.mealId, mealId), eq(schema.mealItems.ownerEmail, owner.userEmail)));
    await tx.delete(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.ownerEmail, owner.userEmail)));
  });
  await recomputeIntakeDay(owner, meal.localDate);
  recordChange({ source: "health", type: "meal", key: mealId, owner: owner.userEmail, orgId: owner.orgId ?? undefined });
  return { deleted: true };
}

export async function listMeals(owner: OwnerScope, range: { from: string; to: string }): Promise<MealView[]> {
  const meals = await getDb()
    .select()
    .from(schema.meals)
    .where(and(eq(schema.meals.ownerEmail, owner.userEmail), gte(schema.meals.localDate, range.from), lte(schema.meals.localDate, range.to)))
    .orderBy(asc(schema.meals.eatenAt));
  const items = await itemsOf(owner, meals.map((m) => m.id));
  return meals.map((m) => toView(m, items.filter((i) => i.mealId === m.id)));
}

/** A user's own food (e.g. read from a nutrition-label photo); visible only to them. */
export async function createFood(owner: OwnerScope, food: Omit<ImportedFood, "source" | "sourceRef" | "createdBy">): Promise<Food> {
  const known = Object.keys(food.nutrients) as NutrientKey[];
  if (!known.includes("energy")) fail("A custom food needs at least energy (kcal per 100 g/ml)", { statusCode: 400, errorCode: "invalid_food" });
  const { ids } = await upsertFoods([{ ...food, source: "custom", sourceRef: randomUUID(), createdBy: owner.userEmail }]);
  return (await getFoods(ids, owner.userEmail)).get(ids[0]!)!;
}
```

> If `mutateUserSetting` in the test needs a different signature, mirror how `server/lib/coach/profile.test.ts` seeds the profile (read it first) — the test only needs `profile.timezone = "Europe/Prague"`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vitls/app test -- meals && pnpm --filter @vitls/app typecheck`
Expected: PASS, including the existing `health/read.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/app/shared/meals.ts apps/app/server/lib/meals/intake.ts apps/app/server/lib/meals/meals.ts apps/app/server/lib/meals/meals.test.ts
git commit -m "feat(app/nutrition): food log with nutrient snapshots and daily intake metrics"
```

---

### Task 8: Meal actions and `get-health` meals

**Files:**
- Create: `apps/app/actions/log-meal.ts`, `apps/app/actions/delete-meal.ts`, `apps/app/actions/create-food.ts`
- Modify: `apps/app/actions/get-health.ts`, `apps/app/server/lib/health/read.ts` (`HEALTH_SECTIONS` + meals), `apps/app/server/lib/health/read.test.ts`

**Interfaces:**
- Consumes: `logMeal`, `deleteMeal`, `listMeals`, `createFood`, `MEAL_TYPES`, `NUTRIENTS`.
- Produces: actions `log-meal` (chat renderer `vitls.meal`, returns `{ meal: MealView }`), `delete-meal`, `create-food`; `get-health` `include: ["meals"]` returns `meals: MealView[]`.

- [ ] **Step 1: Write the failing test** — append to `apps/app/server/lib/health/read.test.ts`

```ts
import { logMeal } from "../meals/meals";

describe("get-health meals section", () => {
  it("returns the owner's meals for the range", async () => {
    await logMeal({ userEmail: "reader@example.com", orgId: null }, { eatenAt: "2026-09-20T12:00:00Z", items: [{ name: "Skyr", amount: 150, unit: "g", nutrients: { protein: 16 } }] });
    const h = await getHealth("reader@example.com", { from: "2026-09-20", to: "2026-09-20", include: ["meals"] });
    expect(h.meals).toHaveLength(1);
    expect(h.meals![0]).toMatchObject({ localDate: "2026-09-20", totals: { protein: 16 } });
    expect(h.daily).toBeUndefined();
  });
});
```

(Ensure the file's `beforeAll(setupTestDb)` covers this `describe`; if the existing `describe` owns the `beforeAll`, place the new `it` inside it instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- health/read`
Expected: FAIL — `"meals"` is not a valid section / `h.meals` undefined.

- [ ] **Step 3: Implement**

`server/lib/health/read.ts`:
- `export const HEALTH_SECTIONS = ["daily", "points", "sleep", "workouts", "meals"] as const;`
- Add `meals?: MealView[]` to the `result` type (import `type MealView` from `../../../shared/meals`).
- Before `return result;`:

```ts
  if (include.has("meals")) {
    // listMeals scopes by owner_email only; org is irrelevant for reads.
    result.meals = await listMeals({ userEmail, orgId: null }, { from: query.from, to: query.to });
  }
```

(import `listMeals` from `../meals/meals`).

`actions/get-health.ts` — update the `include` description to: `'Sections to return: "daily", "points", "sleep", "workouts", "meals" (food log with items); defaults to all'`.

`actions/log-meal.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { NUTRIENTS } from "@vitls/health-ingest";
import { z } from "zod";

import { MEAL_TYPES } from "../shared/meals";
import { requireOwner } from "../server/lib/ingest/owner";
import { logMeal } from "../server/lib/meals/meals";

const nutrients = z.object(Object.fromEntries(NUTRIENTS.map((n) => [n.key, z.number().nonnegative().finite().optional()]))).describe("Totals for this amount, canonical units (kcal, g, mg, µg, ml)");
const item = z.union([
  z.object({ foodId: z.string(), amount: z.number().positive(), unit: z.enum(["g", "ml"]).optional(), portion: z.string().max(80).optional().describe("A portion label from search-foods; amount is then the count") }),
  z.object({ name: z.string().trim().min(1).max(120), amount: z.number().positive(), unit: z.enum(["g", "ml"]), nutrients, estimated: z.boolean().optional() }),
]);

export default defineAction({
  description:
    "Log a meal to the user's food log, or update one (mealId), or repeat one (fromMealId, e.g. \"same as yesterday's breakfast\"). Items: { foodId, amount in g/ml or portion + count } from search-foods, or { name, amount, unit, nutrients } as an estimate when nothing matches. Log straight away after identifying a photo — the meal card lets the user correct amounts. Updates the day's intake totals.",
  schema: z.object({
    mealId: z.string().optional(),
    fromMealId: z.string().optional(),
    eatenAt: z.string().datetime({ offset: true }).optional().describe("When it was eaten; default now"),
    mealType: z.enum(MEAL_TYPES).nullable().optional(),
    note: z.string().max(500).optional(),
    entry: z.enum(["photo", "barcode", "search", "manual"]).optional(),
    items: z.array(item).min(1).max(40).optional(),
  }),
  chatUI: { renderer: "vitls.meal", title: "Meal" },
  run: async (input, ctx) => ({ meal: await logMeal(await requireOwner(ctx), input) }),
});
```

`actions/delete-meal.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwner } from "../server/lib/ingest/owner";
import { deleteMeal } from "../server/lib/meals/meals";

export default defineAction({
  description: "Delete a meal from the user's food log (and update that day's intake totals). Confirm with the user first unless they asked for it.",
  schema: z.object({ mealId: z.string() }),
  run: async ({ mealId }, ctx) => deleteMeal(await requireOwner(ctx), mealId),
});
```

`actions/create-food.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { NUTRIENTS } from "@vitls/health-ingest";
import { z } from "zod";

import { requireOwner } from "../server/lib/ingest/owner";
import { createFood } from "../server/lib/meals/meals";

export default defineAction({
  description:
    "Save the user's own food (only they see it), e.g. read from a photo of a nutrition label: name, brand, barcode, nutrients per 100 g (or 100 ml) and named portions. Returns the food to use with log-meal.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(80).optional(),
    barcode: z.string().regex(/^\d{8,14}$/).optional(),
    basis: z.enum(["100g", "100ml"]).default("100g"),
    nutrients: z.object(Object.fromEntries(NUTRIENTS.map((n) => [n.key, z.number().nonnegative().finite().optional()]))).describe("Per 100 g/ml, canonical units"),
    portions: z.array(z.object({ label: z.string().trim().min(1).max(80), amount: z.number().positive() })).max(10).optional(),
  }),
  run: async (input, ctx) => ({ food: await createFood(await requireOwner(ctx), input) }),
});
```

- [ ] **Step 4: Run tests and a CLI smoke**

Run: `pnpm --filter @vitls/app test && pnpm --filter @vitls/app typecheck && pnpm --filter @vitls/app doctor`
Expected: all PASS, doctor clean.
Run: `pnpm --filter @vitls/app action log-meal --items '[{"name":"Skyr","amount":150,"unit":"g","nutrients":{"protein":16,"energy":95}}]'`
Expected: JSON with `meal.totals.protein = 16`. (If the CLI passes JSON as a string — as seen with `show-widget` — run the same through the HTTP route or skip; the Vitest suite is authoritative.)

- [ ] **Step 5: Commit**

```bash
git add apps/app/actions/log-meal.ts apps/app/actions/delete-meal.ts apps/app/actions/create-food.ts apps/app/actions/get-health.ts apps/app/server/lib/health/read.ts apps/app/server/lib/health/read.test.ts
git commit -m "feat(app/nutrition): log-meal, delete-meal, create-food actions and get-health meals"
```

---

### Task 9: Meal card in chat and intake formatting

**Files:**
- Create: `apps/app/app/components/meals/MealCard.tsx`
- Modify: `apps/app/app/lib/register-chat-renderers.tsx`, `apps/app/app/components/dashboard/HealthWidget.tsx` (`formatValue` units, `TINT_GROUPS`), `apps/app/app/global.css` (frame rule covers the meal card)

**Interfaces:**
- Consumes: `MealView`, `NUTRIENTS`, `useActionMutation("log-meal")`, `useActionMutation("delete-meal")`.
- Produces: `<MealCard meal={MealView} />` (used by chat now, by `/food` and the `meals` widget in plan 3); renderer id `vitls.meal`.

- [ ] **Step 1: Implement `MealCard`**

```tsx
import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { sumNutrients, type MealView } from "../../../shared/meals";

const MACROS = [
  ["energy", "kcal", 0],
  ["protein", "P", 0],
  ["carbs", "C", 0],
  ["fat", "F", 0],
] as const;

const macroLine = (n: MealView["totals"]) =>
  MACROS.map(([k, label, digits]) => (n[k] === undefined ? null : label === "kcal" ? `${n[k]!.toFixed(digits)} kcal` : `${label} ${n[k]!.toFixed(digits)} g`))
    .filter(Boolean)
    .join(" · ");

/**
 * One meal: items with amounts and the meal's macros. Shared by chat (log-meal result), /food and the meals widget
 * (docs/design/06-nutrition.md §8). Editing an amount rescales that item locally at once, then saves through log-meal.
 */
export function MealCard({ meal: initial }: { meal: MealView }) {
  const [meal, setMeal] = useState(initial);
  const [deleted, setDeleted] = useState(false);
  const save = useActionMutation("log-meal");
  const remove = useActionMutation("delete-meal");
  if (deleted) return null;

  const setAmount = (index: number, amount: number) => {
    if (!(amount > 0)) return;
    const items = meal.items.map((item, i) => {
      if (i !== index) return item;
      const factor = amount / item.amount;
      return { ...item, amount, nutrients: Object.fromEntries(Object.entries(item.nutrients).map(([k, v]) => [k, Math.round((v as number) * factor * 100) / 100])) };
    });
    const previous = meal;
    setMeal({ ...meal, items, totals: sumNutrients(items.map((i) => i.nutrients)) });
    save.mutate(
      { mealId: meal.id, items: items.map((i) => (i.foodId ? { foodId: i.foodId, amount: i.amount, unit: i.unit } : { name: i.name, amount: i.amount, unit: i.unit, nutrients: i.nutrients, estimated: i.estimated })) } as never,
      { onError: () => setMeal(previous) },
    );
  };

  const time = new Date(meal.eatenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Card className="widget-tint widget-tint-butter rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="truncate text-sm font-medium capitalize">
          {meal.mealType ?? "Meal"} · {time}
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Meal options">
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => save.mutate({ fromMealId: meal.id } as never)}>Repeat now</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => remove.mutate({ mealId: meal.id } as never, { onSuccess: () => setDeleted(true) })}>Delete</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1">
          {meal.items.map((item, i) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">
                {item.name}
                {item.estimated && <span className="text-muted-foreground"> · est.</span>}
              </span>
              <label className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  defaultValue={item.amount}
                  aria-label={`${item.name} amount in ${item.unit}`}
                  className="h-7 w-20 text-right"
                  onBlur={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value !== item.amount) setAmount(i, value);
                  }}
                />
                {item.unit}
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium tabular-nums">{macroLine(meal.totals)}</p>
      </CardContent>
    </Card>
  );
}
```

(Check `@/components/ui/input` exists; if not, add it from `apps/app`: `pnpm dlx shadcn@latest add input`, then review the generated file.)

- [ ] **Step 2: Register the renderer** — in `app/lib/register-chat-renderers.tsx` (same `…/agentkit-chat/index` specifier):

```tsx
import { MealCard } from "@/components/meals/MealCard";
import type { MealView } from "../../shared/meals";

registerActionChatRenderer({
  id: "vitls.meal",
  renderer: "vitls.meal",
  Component: ({ context }: ToolRendererProps) => {
    const meal = (context.resultJson as { meal?: MealView } | undefined)?.meal;
    return meal ? <MealCard meal={meal} /> : null;
  },
});
```

- [ ] **Step 3: Intake formatting and tint** — in `HealthWidget.tsx`:
- `formatValue` suffixes: add `g: " g", mg: " mg", ug: " µg", ml: " ml"` and use 0 decimals for `g`/`mg`/`ml`.
- `tintFor`: before the group lookup, `if (key.startsWith("intake_")) return "butter";` (nutrition shares the plan/butter tile; `TINT_GROUPS.butter` comment becomes `// plan & nutrition`).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @vitls/app typecheck && pnpm --filter @vitls/app test`
Expected: PASS.
In the browser (`pnpm vibe` running on :8081), in a new chat: "Zjedol som 2 vajcia a 30 g chleba" → the coach calls `search-foods` and `log-meal` (after Task 10's skill), a butter meal card appears without an outer frame; changing the egg amount to 150 updates the macro line immediately and persists after reload; `/dashboard` → ask the coach "pridaj widget bielkovín" shows an `intake_protein` metric widget. Verify in both themes.

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/components/meals/MealCard.tsx apps/app/app/lib/register-chat-renderers.tsx apps/app/app/components/dashboard/HealthWidget.tsx
git commit -m "feat(app/nutrition): meal card in chat with inline amount edits"
```

---

### Task 10: Coach skill, tools and tone rule

**Files:**
- Create: `apps/app/.agents/skills/food-logging/SKILL.md`
- Modify: `apps/app/AGENTS.md` (Coach Tools table), `apps/app/server/plugins/agent-chat.ts` (`INITIAL_TOOL_NAMES`), `docs/design/03-coach.md` (tone rule line ~95), `docs/design/06-nutrition.md` (status line: "APPROVED · plan 1 implemented")

**Interfaces:**
- Consumes: actions `search-foods`, `log-meal`, `delete-meal`, `create-food`, `get-health` meals.

- [ ] **Step 1: Write the skill** — `.agents/skills/food-logging/SKILL.md`

```markdown
---
name: food-logging
description: How the coach logs food from photos, barcodes, labels, text or voice, and how it talks about intake. Use whenever the user sends a food photo, names something they ate or drank, or asks about their nutrition.
scope: runtime
---

# Food logging

Goal: the fastest accurate log. One meal = one `log-meal` call.

## Flow
1. **Food photo** — list the items you see and estimate each amount in grams/ml (plate size, cutlery and packaging are your scale).
   For each item call `search-foods` (English generic names work best; use the brand when visible). Then call `log-meal`
   right away with `entry: "photo"` — do not ask "shall I log it?": the meal card lets the user fix amounts in one tap.
2. **Barcode photo** — read the digits, `search-foods { barcode }`, ask the amount only if you can't infer it, then `log-meal`.
3. **Nutrition label photo** — `create-food` with the per-100 g values, then `log-meal` with the eaten amount.
4. **Text or voice** ("2 eggs and a toast") — same as a photo, without the photo.
5. **"Same as yesterday"** — find the meal with `get-health { include: ["meals"] }`, then `log-meal { fromMealId }`.
6. **No database match** (home cooking, restaurant dish) — log an item `{ name, amount, unit, nutrients, estimated: true }`
   with your best estimate; say it's an estimate.
7. **Genuine ambiguity that changes the numbers a lot** (half-fat vs low-fat quark, cooked vs dry rice) — one `ask-question`
   with buttons, then log. Otherwise pick the most likely option and log.

## After logging
- Reply with at most one sentence of context from the day so far (`get-health { include: ["daily"], metrics: ["intake_protein", "intake_energy"] }`),
  e.g. "Protein 142/175 g — dinner left." The card shows the rest; don't repeat the item list.
- Meal time: use the time the user says; otherwise now. Meal type: infer from the time and the user's habits, or leave it empty.

## Tone
Follow the persona and strictness in `<coach-profile>`. A strict persona may be blunt about the numbers ("600 kcal over today,
we balance it tomorrow"), but never attacks the person (no "you're weak", no shaming), never moralises a food as good/bad,
and never suggests compensating with fasting or purging.
```

- [ ] **Step 2: Wire tools and docs**

`server/plugins/agent-chat.ts` — add to `INITIAL_TOOL_NAMES`: `"search-foods", "log-meal", "delete-meal", "create-food"`.

`AGENTS.md` Coach Tools table — add a row after `log-health-data`:

```markdown
| `search-foods` / `log-meal` / `delete-meal` / `create-food` | Food log: search the food database (name or barcode), log or edit a meal (items from search or estimates; `fromMealId` repeats a meal), delete, save the user's own food from a nutrition label. Photos: identify items + grams, search each, log straight away (skill `food-logging`). Daily totals come back in `get-health` as `intake_*` metrics; meals via `include: ["meals"]` |
```

`docs/design/03-coach.md` — replace "strict persona never shames food choices." with "persona sets the tone on food too: blunt about numbers is fine, attacking the person or moralising food is not (docs/design/06-nutrition.md §5)."

`docs/design/06-nutrition.md` — status line: `Status: **APPROVED** · 2026-10-06 · plan 1 (core) implemented`.

- [ ] **Step 3: Verify end to end**

Run: `pnpm --filter @vitls/app test && pnpm --filter @vitls/app typecheck && pnpm --filter @vitls/app doctor`
Expected: PASS, doctor clean.
Browser (new chat): "Na raňajky som mal 250 g polotučného tvarohu a odmerku srvátkového proteínu" → `search-foods` ×2, one `log-meal`, meal card, one-sentence reply with protein so far, in the persona's voice. `get-health` in a follow-up ("koľko bielkovín mám dnes?") reads `intake_protein`.

- [ ] **Step 4: Security check of the new surface**

Run the `security-audit` skill in guidance mode on `actions/{search-foods,log-meal,delete-meal,create-food}.ts` and `server/lib/{foods,meals}/` with the questions: can any input read or modify another user's meal or custom food; can `search-foods` be used to make the server fetch arbitrary URLs (barcode is digits-only, query is URL-encoded); can an oversized request exhaust resources (item/amount limits). Fix any confirmed finding with a regression test in the owning test file.

- [ ] **Step 5: Commit**

```bash
git add apps/app/.agents/skills/food-logging/SKILL.md apps/app/AGENTS.md apps/app/server/plugins/agent-chat.ts docs/design/03-coach.md docs/design/06-nutrition.md
git commit -m "feat(app/coach): food-logging skill and nutrition tools"
```

---

## Follow-up plans (not in this plan)

2. **Food photos** — S3/MinIO private-blob provider with field-key encryption, chat attachment → private storage spike, `photo` on meals, EXIF/GPS strip, deletion.
3. **`/food` page, widgets and targets** — `nutrition` and `meals` widget kinds, `/food` route with Add meal (photo/barcode/search), nutrition targets with direction and dynamic energy, Slovak/Czech names for common foods, source attribution page.
4. **GLP-1 and doctor export** — GLP-1 goal module, `glp1_dose` and symptom metrics, coach relationships, afternoon nudge, `export-health-report`.
5. **Apple Health / Health Connect** — ingest `meals` contract, companion read/write, loop and double-count rules.
