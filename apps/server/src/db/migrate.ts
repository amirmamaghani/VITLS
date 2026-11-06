import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Creates the target database if absent (dev/test convenience), connecting via the maintenance db. */
async function ensureDatabase(url: URL) {
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString());
  try {
    const found = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) await sql.unsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await sql.end();
  }
}

const HYPERTABLES = [
  ["daily_metrics", "day", "90 days"],
  ["point_metrics", "at", "90 days"],
  ["intraday_series", "start_at", "7 days"],
] as const;

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  await ensureDatabase(new URL(raw));

  const sql = postgres(raw, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

    // TimescaleDB where available; plain Postgres keeps ordinary tables.
    const available = await sql`SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'`;
    if (available.length === 0) return;
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS timescaledb");
    for (const [table, column, interval] of HYPERTABLES) {
      await sql.unsafe(`SELECT create_hypertable('${table}', by_range('${column}', INTERVAL '${interval}'), if_not_exists => TRUE, migrate_data => TRUE)`);
    }
    // Intraday chunks are written once and read rarely after a month: compress per owner and metric.
    await sql.unsafe("ALTER TABLE intraday_series SET (timescaledb.compress, timescaledb.compress_segmentby = 'owner_email, metric', timescaledb.compress_orderby = 'start_at')");
    await sql.unsafe("SELECT add_compression_policy('intraday_series', INTERVAL '30 days', if_not_exists => TRUE)");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
