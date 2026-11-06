import {
  bigint,
  doublePrecision,
  index,
  integer,
  ownableColumns,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";
import { createDashboardStorageSchema } from "@agent-native/core/dashboard-storage";
import { date, primaryKey, timestamp } from "drizzle-orm/pg-core";

import { encryptedJson, encryptedText } from "./encrypted";

/**
 * Health data model — see docs/design/02-data-model-and-ingest.md.
 * Every user-data row is ownable: owner_email = the person the data belongs to, org_id = tenant.
 * Measured instants are TIMESTAMPTZ and calendar days DATE (TimescaleDB partition columns); bookkeeping
 * timestamps are TEXT (framework convention). daily_metrics, point_metrics and intraday_series are
 * hypertables where TimescaleDB is available, so their keys always include the time column and they have
 * no surrogate id. Keys double as upsert targets for idempotent ingest.
 */

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export interface SleepStage {
  stage: "awake" | "light" | "deep" | "rem" | "unknown";
  start: string;
  end: string;
}

export interface WorkoutSet {
  exercise: string;
  reps?: number;
  weightKg?: number;
  durationS?: number;
}

/** A connected data source for a user: one per provider and channel; device_token_id is the token that last fed it. */
export const healthSources = table(
  "health_sources",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    via: text("via").notNull(),
    deviceTokenId: text("device_token_id").notNull(),
    label: text("label"),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    lastSyncAt: text("last_sync_at"),
    createdAt: text("created_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    uniqueIndex("health_sources_device_uq").on(t.ownerEmail, t.deviceTokenId, t.provider, t.via),
    uniqueIndex("health_sources_provider_uq").on(t.ownerEmail, t.provider, t.via),
  ],
);

/** Daily values in long layout (one row per user, source, day and metric). */
export const dailyMetrics = table(
  "daily_metrics",
  {
    sourceId: text("source_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    externalId: text("external_id"),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    primaryKey({ name: "daily_metrics_pk", columns: [t.ownerEmail, t.sourceId, t.metric, t.day] }),
    index("daily_metrics_owner_metric_day_idx").on(t.ownerEmail, t.metric, t.day),
  ],
);

/** Point-in-time measurements (weigh-ins, VO2max estimates, blood pressure). */
export const pointMetrics = table(
  "point_metrics",
  {
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    at: instant("at").notNull(),
    zoneOffset: text("zone_offset"),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    primaryKey({ name: "point_metrics_pk", columns: [t.ownerEmail, t.sourceId, t.externalId, t.at] }),
    index("point_metrics_owner_metric_at_idx").on(t.ownerEmail, t.metric, t.at),
  ],
);

export const sleepSessions = table(
  "sleep_sessions",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    startAt: instant("start_at").notNull(),
    endAt: instant("end_at").notNull(),
    durationS: integer("duration_s").notNull(),
    stages: encryptedJson<SleepStage[]>("sleep_sessions", "stages"),
    scores: text("scores"),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    uniqueIndex("sleep_sessions_uq").on(t.ownerEmail, t.sourceId, t.externalId),
    index("sleep_sessions_owner_start_idx").on(t.ownerEmail, t.startAt),
  ],
);

export const workouts = table(
  "workouts",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    startAt: instant("start_at").notNull(),
    endAt: instant("end_at").notNull(),
    distanceM: doublePrecision("distance_m"),
    energyKcal: doublePrecision("energy_kcal"),
    avgHr: doublePrecision("avg_hr"),
    maxHr: doublePrecision("max_hr"),
    poolLengthM: doublePrecision("pool_length_m"),
    strokes: integer("strokes"),
    zones: text("zones"),
    sets: encryptedJson<WorkoutSet[]>("workouts", "sets"),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    uniqueIndex("workouts_uq").on(t.ownerEmail, t.sourceId, t.externalId),
    index("workouts_owner_start_idx").on(t.ownerEmail, t.startAt),
  ],
);

/** Premium tier: compact intraday series chunks (values as a JSON array at a fixed interval). */
export const intradaySeries = table(
  "intraday_series",
  {
    sourceId: text("source_id").notNull(),
    metric: text("metric").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    startAt: instant("start_at").notNull(),
    intervalS: integer("interval_s").notNull(),
    values: text("values").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => [
    primaryKey({ name: "intraday_series_pk", columns: [t.ownerEmail, t.sourceId, t.metric, t.startAt] }),
    index("intraday_series_owner_metric_day_idx").on(t.ownerEmail, t.metric, t.day),
  ],
);

/** Idempotency ledger + encrypted raw archive (enables intraday backfill after an upgrade). */
export const ingestBatches = table(
  "ingest_batches",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    sourceId: text("source_id").notNull(),
    receivedAt: text("received_at").notNull(),
    counts: text("counts").notNull(),
    raw: encryptedJson<unknown>("ingest_batches", "raw"),
    rawExpiresAt: text("raw_expires_at"),
    ...ownableColumns(),
  },
  (t) => [uniqueIndex("ingest_batches_uq").on(t.ownerEmail, t.batchId)],
);

/** One-time pairing codes (only the hash is stored). */
export const devicePairings = table(
  "device_pairings",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
    ...ownableColumns(),
  },
);

/** Write-only device credentials (only the hash is stored). */
export const deviceTokens = table(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    label: text("label"),
    platform: text("platform"),
    scope: text("scope").notNull().default("ingest:write"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    ...ownableColumns(),
  },
);

/**
 * Fixed-window counters for device-facing rate limits and quotas (keys like `ingest:req:<deviceId>`).
 * Not user data: keys hold opaque ids or IP hashes only. Excluded from agent DB tools (agent-native.json).
 */
export const rateLimits = table("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
});

/** Agent-designed dashboards (docs/design/04-dashboards.md): native dashboard-storage tables. */
export const { dashboards, dashboardRevisions, dashboardShares } = createDashboardStorageSchema({
  dashboardsTable: "vitls_dashboards",
  revisionsTable: "vitls_dashboard_revisions",
  sharesTable: "vitls_dashboard_shares",
});

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
