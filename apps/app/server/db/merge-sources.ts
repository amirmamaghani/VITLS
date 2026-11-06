/**
 * One health source per user, provider and channel. Re-pairing a phone used to create a second source under the new
 * device token, and every record it re-sent landed again beside the first copy (uniqueness was per source).
 * This SQL folds the older sources of each (owner, provider, via) group into the newest one, dropping the rows the
 * newest already holds, and is idempotent: with no duplicate sources it changes nothing.
 */
const LOSERS = `WITH ranked AS (
  SELECT id, owner_email, provider, via,
         row_number() OVER (PARTITION BY owner_email, provider, via ORDER BY last_sync_at DESC NULLS LAST, created_at DESC) AS rn
  FROM health_sources
), losers AS (
  SELECT l.id AS loser, k.id AS keeper
  FROM ranked l JOIN ranked k ON k.owner_email = l.owner_email AND k.provider = l.provider AND k.via = l.via AND k.rn = 1
  WHERE l.rn > 1
)`;

/** Natural key of each data table without source_id: rows the keeper already has are dropped, the rest move over. */
const TABLES: Record<string, string[]> = {
  daily_metrics: ["metric", "day"],
  point_metrics: ["external_id", "at"],
  intraday_series: ["metric", "start_at"],
  sleep_sessions: ["external_id"],
  workouts: ["external_id"],
};

const fold = (table: string, key: string[]) => {
  const same = key.map((c) => `k.${c} = t.${c}`).join(" AND ");
  return [
    `${LOSERS}
DELETE FROM ${table} t USING losers
WHERE t.source_id = losers.loser
  AND EXISTS (SELECT 1 FROM ${table} k WHERE k.owner_email = t.owner_email AND k.source_id = losers.keeper AND ${same})`,
    `${LOSERS}
UPDATE ${table} t SET source_id = losers.keeper FROM losers WHERE t.source_id = losers.loser`,
  ];
};

/** One statement per entry; the migration runner joins them, tests run them one by one. */
export const MERGE_DUPLICATE_SOURCES_STATEMENTS: readonly string[] = [
  ...Object.entries(TABLES).flatMap(([table, key]) => fold(table, key)),
  `${LOSERS}
UPDATE ingest_batches t SET source_id = losers.keeper FROM losers WHERE t.source_id = losers.loser`,
  `${LOSERS}
DELETE FROM health_sources t USING losers WHERE t.id = losers.loser`,
];
