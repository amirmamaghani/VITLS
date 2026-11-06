import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { encryptedJson, encryptedText } from "./encrypted";

/**
 * Health data model — see docs/design/02-data-model-and-ingest.md.
 * Every user-data row is owner-scoped: owner_email = the person the data belongs to (single-tenant,
 * no org_id). Measured instants are TIMESTAMPTZ and calendar days DATE (TimescaleDB partition
 * columns); bookkeeping timestamps are TEXT. daily_metrics, point_metrics and intraday_series become
 * hypertables where TimescaleDB is available (a migration concern — Task 3), so their keys always
 * include the time column and they have no surrogate id. Keys double as upsert targets for
 * idempotent ingest.
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
export const healthSources = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    uniqueIndex("health_sources_device_uq").on(t.ownerEmail, t.deviceTokenId, t.provider, t.via),
    uniqueIndex("health_sources_provider_uq").on(t.ownerEmail, t.provider, t.via),
  ],
);

/** Daily values in long layout (one row per user, source, day and metric). */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    sourceId: text("source_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    externalId: text("external_id"),
    updatedAt: text("updated_at").notNull(),
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    primaryKey({ name: "daily_metrics_pk", columns: [t.ownerEmail, t.sourceId, t.metric, t.day] }),
    index("daily_metrics_owner_metric_day_idx").on(t.ownerEmail, t.metric, t.day),
  ],
);

/** Point-in-time measurements (weigh-ins, VO2max estimates, blood pressure). */
export const pointMetrics = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    primaryKey({ name: "point_metrics_pk", columns: [t.ownerEmail, t.sourceId, t.externalId, t.at] }),
    index("point_metrics_owner_metric_at_idx").on(t.ownerEmail, t.metric, t.at),
  ],
);

export const sleepSessions = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    uniqueIndex("sleep_sessions_uq").on(t.ownerEmail, t.sourceId, t.externalId),
    index("sleep_sessions_owner_start_idx").on(t.ownerEmail, t.startAt),
  ],
);

export const workouts = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    uniqueIndex("workouts_uq").on(t.ownerEmail, t.sourceId, t.externalId),
    index("workouts_owner_start_idx").on(t.ownerEmail, t.startAt),
  ],
);

/** Premium tier: compact intraday series chunks (values as a JSON array at a fixed interval). */
export const intradaySeries = pgTable(
  "intraday_series",
  {
    sourceId: text("source_id").notNull(),
    metric: text("metric").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    startAt: instant("start_at").notNull(),
    intervalS: integer("interval_s").notNull(),
    values: text("values").notNull(),
    updatedAt: text("updated_at").notNull(),
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [
    primaryKey({ name: "intraday_series_pk", columns: [t.ownerEmail, t.sourceId, t.metric, t.startAt] }),
    index("intraday_series_owner_metric_day_idx").on(t.ownerEmail, t.metric, t.day),
  ],
);

/** Idempotency ledger + encrypted raw archive (enables intraday backfill after an upgrade). */
export const ingestBatches = pgTable(
  "ingest_batches",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    sourceId: text("source_id").notNull(),
    receivedAt: text("received_at").notNull(),
    counts: text("counts").notNull(),
    raw: encryptedJson<unknown>("ingest_batches", "raw"),
    rawExpiresAt: text("raw_expires_at"),
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [uniqueIndex("ingest_batches_uq").on(t.ownerEmail, t.batchId)],
);

/** One-time pairing codes (only the hash is stored). */
export const devicePairings = pgTable("device_pairings", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
  ownerEmail: text("owner_email").notNull(),
});

/** Write-only device credentials (only the hash is stored). */
export const deviceTokens = pgTable("device_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  label: text("label"),
  platform: text("platform"),
  scope: text("scope").notNull().default("ingest:write"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  ownerEmail: text("owner_email").notNull(),
});

/**
 * Fixed-window counters for device-facing rate limits and quotas (keys like `ingest:req:<deviceId>`).
 * Not user data: keys hold opaque ids or IP hashes only.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
});

/**
 * BetterAuth core tables (user, session, account, verification). Field names and column
 * attributes mirror BetterAuth 1.7.6's default schema (@better-auth/core getAuthTables)
 * so the drizzleAdapter resolves them from DbService's fullSchema. camelCase column names
 * match `@better-auth/cli generate` output exactly. Sign-in is magic-link only, keyed on
 * user.email; the account/password columns stay for BetterAuth's own bookkeeping.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Expo push tokens per user; a device's tokens are dropped when it is revoked. */
export const expoPushTokens = pgTable(
  "expo_push_tokens",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    token: text("token").notNull(),
    label: text("label"),
    deviceId: text("device_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("expo_push_tokens_owner_token_uq").on(t.ownerEmail, t.token)],
);

/** Owner-scoped key/value settings (coach profile, training plan). Plaintext: preferences only, no PHI. */
export const userSettings = pgTable(
  "user_settings",
  {
    ownerEmail: text("owner_email").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerEmail, t.key] })],
);

/** One coach chat thread per (owner, dashboard): the AI SDK UIMessage[] as a single blob, replaced wholesale on save. */
export const chatThreads = pgTable(
  "chat_threads",
  {
    ownerEmail: text("owner_email").notNull(),
    dashboardId: text("dashboard_id").notNull(),
    messages: jsonb("messages").notNull().default([]),
    title: text("title"),
    updatedAt: text("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.ownerEmail, t.dashboardId] })],
);

/**
 * Food reference data (docs/design/06-nutrition.md): shared, not PHI, so no owner_email. `created_by` is set only
 * for a user's own foods; reference rows from USDA/CIQUAL/BLS/Open Food Facts have it null.
 */
export const foods = pgTable(
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
export const foodNutrients = pgTable(
  "food_nutrients",
  { foodId: text("food_id").notNull(), nutrient: text("nutrient").notNull(), amount: doublePrecision("amount").notNull() },
  (t) => [primaryKey({ name: "food_nutrients_pk", columns: [t.foodId, t.nutrient] })],
);

/** Named portions ("1 egg" = 50 g); amount is in the food's basis unit (g or ml). */
export const foodPortions = pgTable(
  "food_portions",
  { foodId: text("food_id").notNull(), label: text("label").notNull(), amount: doublePrecision("amount").notNull() },
  (t) => [primaryKey({ name: "food_portions_pk", columns: [t.foodId, t.label] })],
);

/** Names per language; search_name = searchKey(name). */
export const foodNames = pgTable(
  "food_names",
  { foodId: text("food_id").notNull(), lang: text("lang").notNull(), name: text("name").notNull(), searchName: text("search_name").notNull() },
  (t) => [primaryKey({ name: "food_names_pk", columns: [t.foodId, t.lang] })],
);

/** One eaten meal (PHI; note is field-encrypted). meal_type uses the HealthKit / Health Connect enum. */
export const meals = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [index("meals_owner_date_idx").on(t.ownerEmail, t.localDate)],
);

/** Meal items with a nutrient snapshot (totals for this amount), so reference updates never rewrite history. */
export const mealItems = pgTable(
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
    ownerEmail: text("owner_email").notNull(),
  },
  (t) => [index("meal_items_meal_idx").on(t.mealId)],
);

/**
 * Agent-designed dashboards (docs/design/04-dashboards.md). Reimplemented as plain tables over DbService
 * (DashboardStore) — no sharing, single-tenant so no org_id/visibility. config is PLAINTEXT JSON (not PHI),
 * timestamps are TEXT ISO strings. Each save keeps the version it replaced as a revision (undo).
 */
export const dashboards = pgTable("vitls_dashboards", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  config: text("config").notNull(),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
  archivedAt: text("archived_at"),
});

/** A snapshot of a dashboard as it was before a save/restore replaced it; newest first by created_at. */
export const dashboardRevisions = pgTable(
  "vitls_dashboard_revisions",
  {
    id: text("id").primaryKey(),
    dashboardId: text("dashboard_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    config: text("config").notNull(),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
    chatContext: text("chat_context"),
  },
  (t) => [index("vitls_dashboard_revisions_dashboard_idx").on(t.dashboardId, t.createdAt)],
);

/** Coach notes about the owner (plaintext, like the agent-native memory store it replaces). */
export const coachMemories = pgTable(
  "coach_memories",
  {
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    content: text("content").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerEmail, t.name] }), index("coach_memories_owner_idx").on(t.ownerEmail)],
);

/** Read-only data grants: owner lets grantee read their data. Writes are never shareable. Re-grant clears revoked_at. */
export const dataShares = pgTable(
  "data_shares",
  {
    ownerEmail: text("owner_email").notNull(),
    granteeEmail: text("grantee_email").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [primaryKey({ columns: [t.ownerEmail, t.granteeEmail] }), index("data_shares_grantee_idx").on(t.granteeEmail)],
);
