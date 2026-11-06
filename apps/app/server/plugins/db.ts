import { deferMigration, runMigrations } from "@agent-native/core/db";

import { MERGE_DUPLICATE_SOURCES_STATEMENTS } from "../db/merge-sources";

/**
 * VITLS app migrations. Append-only: every entry needs a unique `name`, must be additive and
 * backward compatible (no DROP/RENAME, no NOT NULL without DEFAULT). See docs/design/02-data-model-and-ingest.md.
 */
const ownable = `owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'`;

export const runVitlsMigrations = runMigrations(
  [
    {
      version: 1,
      name: "health-sources-table",
      sql: `CREATE TABLE IF NOT EXISTS health_sources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  via TEXT NOT NULL,
  device_token_id TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  ${ownable}
);
CREATE UNIQUE INDEX IF NOT EXISTS health_sources_device_uq ON health_sources (owner_email, device_token_id, provider, via)`,
    },
    {
      version: 2,
      name: "daily-metrics-table",
      sql: `CREATE TABLE IF NOT EXISTS daily_metrics (
  source_id TEXT NOT NULL,
  day DATE NOT NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  external_id TEXT,
  updated_at TEXT NOT NULL,
  ${ownable},
  CONSTRAINT daily_metrics_pk PRIMARY KEY (owner_email, source_id, metric, day)
);
CREATE INDEX IF NOT EXISTS daily_metrics_owner_metric_day_idx ON daily_metrics (owner_email, metric, day)`,
    },
    {
      version: 3,
      name: "point-metrics-table",
      sql: `CREATE TABLE IF NOT EXISTS point_metrics (
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  zone_offset TEXT,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ${ownable},
  CONSTRAINT point_metrics_pk PRIMARY KEY (owner_email, source_id, external_id, at)
);
CREATE INDEX IF NOT EXISTS point_metrics_owner_metric_at_idx ON point_metrics (owner_email, metric, at)`,
    },
    {
      version: 4,
      name: "sleep-sessions-table",
      sql: `CREATE TABLE IF NOT EXISTS sleep_sessions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_s INTEGER NOT NULL,
  stages TEXT,
  scores TEXT,
  updated_at TEXT NOT NULL,
  ${ownable}
);
CREATE UNIQUE INDEX IF NOT EXISTS sleep_sessions_uq ON sleep_sessions (owner_email, source_id, external_id);
CREATE INDEX IF NOT EXISTS sleep_sessions_owner_start_idx ON sleep_sessions (owner_email, start_at)`,
    },
    {
      version: 5,
      name: "workouts-table",
      sql: `CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  distance_m DOUBLE PRECISION,
  energy_kcal DOUBLE PRECISION,
  avg_hr DOUBLE PRECISION,
  max_hr DOUBLE PRECISION,
  zones TEXT,
  sets TEXT,
  updated_at TEXT NOT NULL,
  ${ownable}
);
CREATE UNIQUE INDEX IF NOT EXISTS workouts_uq ON workouts (owner_email, source_id, external_id);
CREATE INDEX IF NOT EXISTS workouts_owner_start_idx ON workouts (owner_email, start_at)`,
    },
    {
      version: 6,
      name: "intraday-series-table",
      sql: `CREATE TABLE IF NOT EXISTS intraday_series (
  source_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  day DATE NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  interval_s INTEGER NOT NULL,
  "values" TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ${ownable},
  CONSTRAINT intraday_series_pk PRIMARY KEY (owner_email, source_id, metric, start_at)
);
CREATE INDEX IF NOT EXISTS intraday_series_owner_metric_day_idx ON intraday_series (owner_email, metric, day)`,
    },
    {
      version: 7,
      name: "ingest-batches-table",
      sql: `CREATE TABLE IF NOT EXISTS ingest_batches (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  counts TEXT NOT NULL,
  raw TEXT,
  raw_expires_at TEXT,
  ${ownable}
);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_batches_uq ON ingest_batches (owner_email, batch_id)`,
    },
    {
      version: 8,
      name: "device-pairings-and-tokens-tables",
      sql: `CREATE TABLE IF NOT EXISTS device_pairings (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  ${ownable}
);
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  label TEXT,
  platform TEXT,
  scope TEXT NOT NULL DEFAULT 'ingest:write',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  ${ownable}
)`,
    },
    {
      version: 9,
      name: "coach-facts-table",
      sql: `CREATE TABLE IF NOT EXISTS coach_facts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  last_confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ${ownable}
);
CREATE INDEX IF NOT EXISTS coach_facts_owner_kind_idx ON coach_facts (owner_email, kind)`,
    },
    {
      version: 10,
      name: "rate-limits-table-and-archive-expiry-index",
      sql: `CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_batches_raw_expiry_idx ON ingest_batches (raw_expires_at) WHERE raw IS NOT NULL`,
    },
    {
      version: 11,
      name: "timescale-hypertables",
      // TimescaleDB where available (local infra, Timescale Cloud / self-hosted); a no-op on PGlite and plain Postgres.
      sql: {},
      run: async (exec) => {
        const available = await exec.execute("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'");
        if (available.rows.length === 0) return;
        await exec.execute("CREATE EXTENSION IF NOT EXISTS timescaledb");
        for (const [table, column, interval] of [
          ["daily_metrics", "day", "90 days"],
          ["point_metrics", "at", "90 days"],
          ["intraday_series", "start_at", "7 days"],
        ]) {
          await exec.execute(`SELECT create_hypertable('${table}', by_range('${column}', INTERVAL '${interval}'), if_not_exists => TRUE, migrate_data => TRUE)`);
        }
        // Intraday chunks are written once and read rarely after a month: compress them per owner and metric.
        await exec.execute("ALTER TABLE intraday_series SET (timescaledb.compress, timescaledb.compress_segmentby = 'owner_email, metric', timescaledb.compress_orderby = 'start_at')");
        await exec.execute("SELECT add_compression_policy('intraday_series', INTERVAL '30 days', if_not_exists => TRUE)");
      },
    },
    {
      version: 12,
      name: "dashboard-storage-tables",
      // DDL for @agent-native/core/dashboard-storage (same as corpus crm / quantal), vitls_ prefix.
      sql: `CREATE TABLE IF NOT EXISTS vitls_dashboards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_by TEXT,
  archived_at TEXT,
  ${ownable}
);
CREATE TABLE IF NOT EXISTS vitls_dashboard_revisions (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  created_by TEXT,
  chat_context TEXT,
  ${ownable}
);
CREATE TABLE IF NOT EXISTS vitls_dashboard_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  notified_at TEXT
);
CREATE INDEX IF NOT EXISTS vitls_dashboards_owner_updated_idx ON vitls_dashboards (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS vitls_dashboard_revisions_dashboard_created_idx ON vitls_dashboard_revisions (dashboard_id, created_at);
CREATE INDEX IF NOT EXISTS vitls_dashboard_shares_principal_idx ON vitls_dashboard_shares (resource_id, principal_type, principal_id)`,
    },
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
      // pg_trgm where available (local infra and managed Postgres): speeds up substring search (LIKE); typo tolerance comes later. A no-op on PGlite.
      sql: {},
      run: async (exec) => {
        const available = await exec.execute("SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'");
        if (available.rows.length === 0) return;
        await exec.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        await exec.execute("CREATE INDEX IF NOT EXISTS food_names_search_trgm_idx ON food_names USING gin (search_name gin_trgm_ops)");
      },
    },
    {
      version: 15,
      name: "workouts-swim-fields",
      sql: `ALTER TABLE workouts ADD COLUMN IF NOT EXISTS pool_length_m DOUBLE PRECISION;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS strokes INTEGER`,
    },
    {
      version: 16,
      name: "one-source-per-provider",
      sql: `${MERGE_DUPLICATE_SOURCES_STATEMENTS.join(";\n")};
CREATE UNIQUE INDEX IF NOT EXISTS health_sources_provider_uq ON health_sources (owner_email, provider, via)`,
    },
    {
      version: 17,
      name: "chat-thread-run-cursor",
      // shortcut: core writes the raw stream cursor into agentKit.runs[].lastSequence while the client numbers its
      // events differently, so tool runs never get their events persisted and every load replays them
      // (BuilderIO/agent-native#7377). A run without persisted events gets cursor 0: nothing to catch up, and the
      // client's own event batch is no longer stale. Deferred until the framework has created chat_threads.
      // Drop this migration once #7377 ships.
      sql: {},
      run: async (exec) => {
        const table = await exec.execute("SELECT to_regclass('chat_threads') AS t");
        if (!(table.rows[0] as { t: string | null } | undefined)?.t) return deferMigration();
        await exec.execute(`CREATE OR REPLACE FUNCTION vitls_chat_thread_run_cursor() RETURNS trigger AS $fn$
DECLARE d jsonb; runs jsonb; r jsonb; fixed jsonb := '[]'::jsonb; changed boolean := false;
BEGIN
  IF NEW.thread_data IS NULL OR left(NEW.thread_data, 1) <> '{' THEN RETURN NEW; END IF;
  d := NEW.thread_data::jsonb;
  runs := d #> '{agentKit,runs}';
  IF runs IS NULL OR jsonb_typeof(runs) <> 'array' THEN RETURN NEW; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(runs) LOOP
    IF coalesce((r->>'lastSequence')::int, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(d #> '{agentKit,events}', '[]'::jsonb)) e WHERE e->>'runId' = r->>'id'
    ) THEN
      r := jsonb_set(r, '{lastSequence}', '0'::jsonb); changed := true;
    END IF;
    fixed := fixed || jsonb_build_array(r);
  END LOOP;
  IF changed THEN NEW.thread_data := jsonb_set(d, '{agentKit,runs}', fixed)::text; END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql`);
        await exec.execute(`CREATE OR REPLACE TRIGGER chat_threads_run_cursor BEFORE INSERT OR UPDATE OF thread_data ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION vitls_chat_thread_run_cursor()`);
      },
    },
    {
      version: 18,
      name: "chat-thread-merge-flag",
      // shortcut: replaces the v17 function. The run cursor becomes the highest persisted event sequence of that run
      // (0 when none), so the client's accepted cursor always matches it and no terminal catch-up starts; v17's
      // "0 only without events" still replayed runs whose compact events stop below the raw cursor. Also drops
      // agentKit._mergeRootMessages, which the client flips when a long run lets the server store the durable user
      // message first; with the flag set every durable user copy renders beside the live one
      // (BuilderIO/agent-native#6998). Drop with v17 once #7377 ships.
      sql: {},
      run: async (exec) => {
        const table = await exec.execute("SELECT to_regclass('chat_threads') AS t");
        if (!(table.rows[0] as { t: string | null } | undefined)?.t) return deferMigration();
        await exec.execute(`CREATE OR REPLACE FUNCTION vitls_chat_thread_run_cursor() RETURNS trigger AS $fn$
DECLARE d jsonb; runs jsonb; r jsonb; fixed jsonb := '[]'::jsonb; changed boolean := false; cursor int;
BEGIN
  IF NEW.thread_data IS NULL OR left(NEW.thread_data, 1) <> '{' THEN RETURN NEW; END IF;
  d := NEW.thread_data::jsonb;
  IF d #> '{agentKit,_mergeRootMessages}' IS NOT NULL THEN d := d #- '{agentKit,_mergeRootMessages}'; changed := true; END IF;
  runs := d #> '{agentKit,runs}';
  IF runs IS NOT NULL AND jsonb_typeof(runs) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(runs) LOOP
      SELECT coalesce(max((e->>'sequence')::int), 0) INTO cursor
        FROM jsonb_array_elements(coalesce(d #> '{agentKit,events}', '[]'::jsonb)) e WHERE e->>'runId' = r->>'id';
      IF coalesce((r->>'lastSequence')::int, 0) <> cursor THEN
        r := jsonb_set(r, '{lastSequence}', to_jsonb(cursor)); changed := true;
      END IF;
      fixed := fixed || jsonb_build_array(r);
    END LOOP;
    IF changed THEN d := jsonb_set(d, '{agentKit,runs}', fixed); END IF;
  END IF;
  IF changed THEN NEW.thread_data := d::text; END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql`);
      },
    },
  ],
  { table: "vitls_migrations" },
);

export default async (nitroApp: unknown): Promise<void> => {
  await runVitlsMigrations(nitroApp);
};
