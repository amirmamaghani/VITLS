---
name: infra
description: "MUST USE for ALL local infrastructure tasks in this app: starting, stopping, or checking Docker services, Mailpit, containers, compose files, ports, the local dev environment, or anything under infra/. Trigger on: 'spin up', 'bring up', 'tear down', 'start services', 'stop services', 'run local infra', 'check health', 'containers', 'stack', 'mailpit', 'inbox', 'local development'. Load this BEFORE running any docker or docker compose command."
---

# Local Infrastructure

This app is an `@agent-native/core` app. The stack has two services: Mailpit,
the SMTP sink that catches every auth email, and **PostgreSQL 17 with TimescaleDB and pgvector**
(`timescale/timescaledb-ha:pg17`). The framework runs on any modern PostgreSQL and creates the `vector`
extension on demand for semantic search. Locally it falls back to PGlite when `DATABASE_URL` is unset;
PGlite has no TimescaleDB, so use Postgres for anything that touches time-series behaviour.

## Naming rule (non-negotiable)

**Every Docker resource this repo creates is grouped under the app's package
name.** The package name is `name` in `package.json` (currently `vitls`).

| Resource | Required form | Example |
|---|---|---|
| Compose project | top-level `name:` in every compose file | `name: vitls` |
| Container | `<project>-<service>` via `container_name` | `vitls-mailpit` |
| Network | left to Compose, which derives `<project>_default` | `vitls_default` |
| Volume | `<project>-<purpose>` | `vitls-postgres-data` |

Never rely on the directory name. Compose defaults the project to the folder
holding the file, which is `infra`, so a file without `name:` produces
`infra_default` and `infra-mailpit-1`. That is the failure this rule exists
to prevent. When adding a compose file, copy the `name:` line first.

Verify after any `up`:

```bash
docker compose ls            # project column must read vitls
docker network ls | grep vitls
```

## Commands

```bash
pnpm infra:up         # start Mailpit + Postgres
pnpm infra:down       # stop the stack (Postgres data stays in its volume)
pnpm mailpit          # start only Mailpit
pnpm postgres         # start only Postgres
docker compose -f infra/docker-compose.yml ps
docker logs vitls-mailpit
docker exec vitls-postgres psql -U vitls -d vitls
```

Always pass `-f infra/docker-compose.yml` when calling `docker compose`
directly. Running it from the repo root without `-f` finds no file.

## Services

| Service | Container | Host ports | Purpose |
|---|---|---|---|
| Mailpit | vitls-mailpit | SMTP 127.0.0.1:1027, inbox http://localhost:8027 | Receives every transactional email in dev |
| PostgreSQL 17 + TimescaleDB + pgvector | vitls-postgres | 127.0.0.1:5435, volume `vitls-timescale-data` (data at `/home/postgres/pgdata`) | Production-parity database; user/password/db all `vitls` |

Ports and credentials come from `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`,
`POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in
the shell or an `infra/.env`. The app's `MAIL_SMTP_PORT` and `DATABASE_URL`
in `apps/app/.env` must match.

To use Postgres instead of PGlite, set in `apps/app/.env`:

```bash
DATABASE_URL=postgres://vitls:vitls@localhost:5435/vitls
```

Data does not move between PGlite and Postgres. Restart `pnpm dev` after the
change; the framework applies its migrations on startup in development.

## TimescaleDB (health time series)

Decision D12 (2026-10-01): health time series live in TimescaleDB from the start.

- **Hypertables** (created by app migration v11 `timescale-hypertables`, only when the `timescaledb`
  extension is available — a no-op on PGlite and plain Postgres, so tests and portability are unaffected):

  | Table | Partition column | Chunk | Notes |
  |---|---|---|---|
  | `daily_metrics` | `day DATE` | 90 days | PK `(owner_email, source_id, metric, day)` |
  | `point_metrics` | `at TIMESTAMPTZ` | 90 days | PK `(owner_email, source_id, external_id, at)` |
  | `intraday_series` | `start_at TIMESTAMPTZ` | 7 days | PK `(owner_email, source_id, metric, start_at)`; **compressed after 30 days** (segment by `owner_email, metric`) |

  `sleep_sessions` and `workouts` stay regular tables (low volume). Every unique key on a hypertable must
  include its partition column — keep that rule when changing these tables (no surrogate `id`).
- **Inspect:**
  ```bash
  docker exec vitls-postgres psql -U vitls -d vitls -c "select hypertable_name, compression_enabled from timescaledb_information.hypertables"
  docker exec vitls-postgres psql -U vitls -d vitls -c "select hypertable_name, range_start, range_end, is_compressed from timescaledb_information.chunks order by 1, 2"
  ```
- **Ad-hoc aggregation** (analysis, not app code — the app's `get-health` buckets portably in code):
  ```sql
  SELECT time_bucket('7 days', day) AS week, metric, avg(value)
  FROM daily_metrics WHERE owner_email = '<email>' GROUP BY 1, 2 ORDER BY 1;
  ```
- **When to add continuous aggregates:** when a read path aggregates more than ~92 days or many users at once
  (cohort analytics). Add them in a new named migration guarded by the same extension check.
- **Hosting:** production needs Postgres with TimescaleDB (Timescale Cloud EU region or self-hosted EU).
  Neon/Supabase offer at most the Apache-licensed subset (no compression/continuous aggregates) — the app still
  works there, without hypertables.

## How email reaches Mailpit

`server/plugins/dev-smtp-relay.ts` activates when `MAIL_SMTP_HOST` is set and
`NODE_ENV` is not production. It relays the framework's Resend call over SMTP.
`apps/app/.env` also needs a placeholder `RESEND_API_KEY` so the framework
enables magic-link sign-in, and `APP_URL` set to the `pnpm dev` port so
emailed links point at the right server. See `.env.example`.

## Automation rules

1. Run the command. The user asked for it. No "shall I".
2. Read status first when diagnosing: `docker ps` and `docker compose ls`.
3. Confirm before anything destructive: removing volumes, `docker system prune`,
   or stopping containers that belong to another project.
4. Other local stacks run on this machine (`dracidennik-*` :5432/:1025/:8025, `quantal-*` :5434/:1026/:8026,
   `getmedoc2-*`). VITLS uses offset ports (:5435, :1027, :8027) to avoid them. Never stop another project's
   containers; report the conflict instead.

## Troubleshooting

| Problem | Fix |
|---|---|
| `port is already allocated` on 5435, 1027 or 8027 | `lsof -nP -iTCP:<port> -sTCP:LISTEN`. If it belongs to another project, ask before stopping it or move VITLS via `POSTGRES_PORT` / `MAILPIT_*_PORT`. |
| `docker compose ls` shows project `infra` | The compose file lost its `name:` line. Restore `name: vitls`, then `pnpm infra:down && pnpm infra:up`. |
| Emails print to the console instead of arriving | `MAIL_SMTP_HOST` or `RESEND_API_KEY` missing from `.env`, or the dev server was not restarted after editing it. |
| Emailed link points at localhost:3000 | Set `APP_URL` in `.env` to the `pnpm dev` port. |
| Container unhealthy | `docker logs vitls-mailpit` or `docker logs vitls-postgres` |
| Semantic search errors mentioning pgvector | The database is not the `timescaledb-ha` image, or `DATABASE_URL` points elsewhere. `CREATE EXTENSION vector` must succeed. |
| `cannot create a unique index without the column "<time>"` | A unique index/PK on a hypertable must include its partition column (see TimescaleDB section). |
| Hypertables missing after a reset | The `timescaledb` extension was unavailable when migration v11 ran (e.g. PGlite). Start from a fresh Postgres volume. |
| Wipe the local database | Confirm with the user first, then `pnpm infra:down && docker volume rm vitls-timescale-data`. |
| Old `vitls-postgres-data` volume | Leftover from the pre-Timescale pg16 image; safe to remove after confirming with the user. |

## Adding a service

1. Add it to `infra/docker-compose.yml` under `services:` with
   `container_name: vitls-<service>` and ports bound to `127.0.0.1`.
2. Name any volume `vitls-<purpose>`.
3. Add a `pnpm <service>` script in `package.json` mirroring `mailpit`.
4. Update the Services table above.
