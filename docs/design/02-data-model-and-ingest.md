# Design: health data model, device ingest & field encryption

Status: **APPROVED** (incl. §7 coach_facts split) · 2026-10-01
Study basis (agent-native-first step 1): core 0.198.8 docs `server-database`, `server-routes`, `security`, `audit-log`,
`multi-tenancy`, `http-api`; `@agent-native/core/{db,db/schema,secrets,server,audit,data-widgets,dashboard-storage}` type defs;
corpus `templates/analytics` (public write-key ingest: `create-analytics-public-key.ts`, `server/handlers/first-party-analytics.ts`).

## 1. Principles

- **One ingest contract** for every device-side source (companion app, `gccli-sync` dev tool, future bridges). Sources never touch the DB.
- **Store everything per source, resolve on read.** Garmin and Apple Health both report steps; we keep both rows and pick per a user/metric source priority when reading. No destructive merge at write time.
- **Metric catalog is data, not code paths.** A new metric = one catalog entry. Long ("key/value") layout for daily metrics.
- **Canonical SI units** in storage (kg, m, s, kcal, bpm, ms, %); conversion at the edge.
- **Tiering at storage, not at ingest.** Devices always send everything; the server stores per entitlement.
- **Platform values only** (D8): no VITLS-derived body-composition models. Trend smoothing happens at read/presentation time.

## 2. Shared package `packages/health-ingest`

Framework-free TS + zod; consumed by `apps/app` (validate), `apps/companion` and `apps/gccli-sync` (build payloads).

- `metricCatalog`: `{ key, unit, kind: "daily" | "point" | "intraday", tier: "free" | "premium", aggregation }`
  e.g. `steps` (daily, count), `active_energy` (daily, kcal), `resting_hr` (daily, bpm), `hrv_rmssd_night` (daily, ms),
  `vo2max` (point), `weight` (point, kg), `body_fat_pct` (point, %), `heart_rate` (intraday, bpm, premium), `stress` (intraday, premium),
  `body_battery` (intraday, premium, Garmin-only).
- `ingestBatchSchema` (modelled on Open Wearables):
  ```ts
  { batchId: uuid, sentAt, source: { provider: "garmin"|"apple_health"|"health_connect"|..., via: "companion"|"gccli-dev", app?, device?, os? },
    daily:    [{ externalId, date, metric, value, unit }],
    points:   [{ externalId, at, zoneOffset, metric, value, unit }],
    intraday: [{ metric, unit, start, intervalSec, values: number[] }],          // compact series
    sleep:    [{ externalId, start, end, stages?: [{ stage, start, end }], scores? }],
    workouts: [{ externalId, type, start, end, distanceM?, energyKcal?, avgHr?, maxHr?, zones?, sets?: [{ exercise, reps, weightKg }] }],
    deleted?: [{ kind, externalId }] }
  ```
- Unit normalization helpers + unit tests. Max batch: 5 MB / 5,000 items (client chunks, like OW).

## 3. Tables (`apps/app/server/db/schema.ts`, migrations via `runMigrations(..., { table: "vitls_migrations" })`, named entries)

All user data rows carry `...ownableColumns()` (`owner_email` = the user, `org_id` = tenant, `visibility` default `private`).
Coach (role) access to client data goes through sharing/app roles later — not by widening these rows.

| Table | Purpose | Key columns | Uniqueness (upsert target) |
|---|---|---|---|
| `health_sources` | A connected source per user, provider and channel; `device_token_id` is the token that last fed it (re-pairing a phone keeps the source, migration 16 merged older duplicates) | provider, via, device_token_id, label, last_sync_at, status | (owner_email, provider, via) |
| `daily_metrics` | Free tier daily values (long layout) | date (TEXT `YYYY-MM-DD`, user-local), metric, value (double), unit, source_id, updated_at | (owner_email, source_id, date, metric) |
| `point_metrics` | Point-in-time values (weigh-ins, VO2max, BP) | at (BIGINT ms), zone_offset, metric, value, unit, source_id, external_id | (owner_email, source_id, external_id) |
| `sleep_sessions` | Sleep with stages | start/end (BIGINT ms), duration_s, stages (encrypted JSON), scores (JSON), source_id, external_id | (owner_email, source_id, external_id) |
| `workouts` | Training sessions | type, start/end, distance_m, energy_kcal, avg_hr, max_hr, zones (JSON), sets (JSON), source_id, external_id | (owner_email, source_id, external_id) |
| `intraday_series` | **Premium only**: compact series chunks | metric, day (TEXT), start (BIGINT), interval_s, values (JSON array), source_id | (owner_email, source_id, metric, day, start) |
| `ingest_batches` | Idempotency + raw archive | batch_id, source_id, received_at, counts (JSON), raw (encrypted JSON), raw_expires_at | (owner_email, batch_id) |
| `device_pairings` | One-time pairing codes | code_hash, expires_at (10 min), consumed_at | code_hash |
| `device_tokens` | Write-only device credentials | token_hash (sha256), prefix, label, scope `ingest:write`, created_at, last_used_at, revoked_at | token_hash |

- Timestamps: TEXT `now()` for bookkeeping (framework convention); measured instants `TIMESTAMPTZ`, calendar days `DATE`.
- **TimescaleDB (D12):** `daily_metrics`, `point_metrics`, `intraday_series` are hypertables with natural primary keys that
  include the time column (no surrogate `id`); intraday chunks compress after 30 days. See the infra skill.
- Indexes: `(owner_email, metric, date)` on `daily_metrics`, `(owner_email, start)` on sessions/workouts, `(owner_email, metric, day)` on `intraday_series`.
- Doctor: all tables are ownable → `no-unscoped-queries` applies; every query uses `accessFilter` or explicit owner/org filters.
  Columns matching identity patterns get `registerIdentityColumns` (`device_tokens` → delete/delete).
- Volume: free ≈ 30–60 rows/user/day; premium adds ~10–30 series chunks/user/day (chunked arrays, not one row per sample).
  Handled by TimescaleDB hypertables + compression (D12); PGlite (tests) runs the same schema without hypertables.

## 4. Tiering (free vs premium)

- `getEntitlements({ orgId, userEmail })` — the single seam (D9). v1 source: org setting `vitls.plan` (`free` default), later billing.
- Ingest always validates the whole batch. Writes: `daily`, `points`, `sleep`, `workouts` for everyone; `intraday` only if `entitlements.intraday`.
- Raw batch archived encrypted in `ingest_batches.raw` with retention (free 30 d, premium 365 d) → upgrade can **backfill intraday from the archive**
  without re-syncing devices. Retention cleanup via a recurring job.
- Open: move the raw archive to EU object storage (private blob provider) once volume grows (framework rule: large payloads not in SQL).

## 5. Pairing & device tokens

Core has no scoped write-only token (Connect tokens = full user; org service tokens = org identity; MCP OAuth rejects custom schemes),
so we add our own, modelled on core `connect-store` (hashing, revoke, last-used) and the analytics public-key pattern.

1. **`create-device-pairing`** action (UI + `pnpm action create-device-pairing` from CLI): returns an 8-char code (+ QR/deep-link `vitls://pair?code=…&host=…`), stores only `sha256(code)`, TTL 10 min, single use.
2. **`POST /api/devices/redeem`** `{ code, device: { platform, model, appVersion }, provider, via }` → creates `device_tokens` row + `health_sources` row, returns `vdt_<random 32B>` **once**.
3. **`POST /api/ingest/v1/batches`** with `Authorization: Bearer vdt_…`:
   resolve token by hash → reject revoked → `runWithRequestContext({ userEmail, orgId })` → validate (`readBodyWithSizeLimit` 5 MB) →
   idempotency on `batch_id` → upsert per table (`onConflictDoUpdate`) → update `last_used_at` / `last_sync_at` →
   `recordChange({ source: "health" })` → `insertAuditEvent` (summary + counts only, no payload) → `200 { accepted counts }`.
3a. Device routes (auth: device token, `vdt_…`):
   - `GET /api/devices/today` — the companion's native Today screen (readout, vitals, today's log).
   - `POST /api/devices/log` — quick manual entries from the Today screen.
   - `POST|DELETE /api/devices/push` — register or remove the device's Expo push token.
4. Rate limit: SQL-count limiter per token (pattern from core device-code limiter), e.g. 60 batches/min.
5. Dev-source guard: `via = "gccli-dev"` accepted only when `VITLS_ENABLE_DEV_SOURCES=1`.
6. **`list-devices` / `revoke-device`** actions → "Connected devices" in settings; the coach can list them too.

**Framework compliance.** `server-routes.mdx` §when-custom-routes allows file routes for "external REST contracts that require a
specific URL path or response shape" and public unauthenticated endpoints; `createAuthPlugin({ publicCorsPaths })` exists for
"public, unauthenticated ingest paths … [that] must perform their own request validation and must not rely on cookies".
First-party precedent: analytics template `server/routes/api/analytics/track.post.ts` + `create-analytics-public-key` action.
Actions can't serve here because `/_agent-native/actions/*` only accepts sessions or full-user Connect JWTs.
Everything user-facing (create pairing, list/revoke devices, all reads) stays an action — no CRUD/pass-through `/api/*` routes
(DEVELOPING.md rule).

**Extraction trigger (decision, 2026-10-01).** Ingest lives in the agent-native app as an isolated module
(`server/lib/ingest/*` + `packages/health-ingest`). Move it to a standalone service only when one of these occurs:
jobs that exceed serverless limits (archive backfills, key-rotation re-encryption), premium intraday volume that loads the main app,
or server-side pulls from cloud provider APIs. The device-facing contract stays unchanged; only the base URL moves.

Paths `/api/devices/redeem` and `/api/ingest/` are registered in `createAuthPlugin({ publicPaths })`; they never use cookies.
Single long-lived opaque token (revocable) in v1 — no refresh-token rotation (smaller surface; revisit if needed).

## 6. Field encryption — `encryptedText()` / `encryptedJson<T>()`

Declared once in the schema; actions never see ciphertext:

```ts
sleepSessions = table("sleep_sessions", {
  ...ownableColumns(),
  stages: encryptedJson<SleepStage[]>("stages"),
});
```

- Implementation: Drizzle `customType` (`toDriver`/`fromDriver`) in `apps/app/server/db/encrypted.ts`.
- Cipher: AES-256-GCM. Stored format `enc:v1:<keyId>:<iv>:<ciphertext+tag>` (base64url).
- **Per-tenant keys:** `HKDF(masterKey[keyId], salt = orgId ?? ownerEmail, info = "vitls-field")`. The org comes from the
  framework request context (`getRequestOrgId()`); missing context ⇒ throw (fail closed).
- **AAD** = `table.column` → a ciphertext can't be moved to another column unnoticed.
- **Key ring** from env `VITLS_FIELD_KEYS="k2:<base64>,k1:<base64>"` (first = active). Rotation = add new key first; a re-encrypt job rewrites old `keyId`s.
  Later swap the env source for an EU KMS without touching tables.
- **Plaintext detection:** a read of a value without the `enc:` prefix throws and logs (catches raw-SQL writes); agent SQL write tools stay disabled for these tables.
- Core's `encryptSecretValue` is not reused: single app-wide key, no AAD, no key IDs.
- **Not encrypted:** numeric metric values, dates/times, metric keys — needed for SQL aggregation and charts. Protected by DB-at-rest encryption + TLS + row scoping.

### What gets `encrypted*` in v1
`ingest_batches.raw`, `sleep_sessions.stages`, `workouts.sets` (+ any free-text notes), coach health facts (§7).

## 7. Coach memory vs. health facts (needs decision)

Framework memory (`memory/*.md`, `LEARNINGS.md`) lives in core resource tables **without field encryption**.
Proposal: **structured health facts** (injuries, conditions, medication, scan anchors, lifestyle events like a quit-smoking date)
go to our own `coach_facts` table (`encryptedJson` body, type, valid_from/to, last_confirmed_at) via actions
(`save-coach-fact`, `list-coach-facts`, `confirm-coach-fact`) — which also gives the "What your coach knows" page and stale-fact verification.
Framework memory is used only for non-sensitive preferences (tone, schedule habits), enforced by coach instructions.

## 8. Testing

- `packages/health-ingest`: unit tests (schema, units, catalog).
- `apps/app`: vitest with in-memory PGlite (`DATABASE_URL=pglite:memory://`) for ingest upsert/idempotency/dedupe, token hashing/revocation,
  encryption round-trip + tamper + wrong-column + missing-context cases, tier filtering.
- `gccli-sync`: mapping tests against recorded gccli JSON fixtures (anonymised).

## 9. Scripts

Root: `pnpm pair:code`, `pnpm gccli:pair|sync|watch|status`, `pnpm test`, `pnpm typecheck`, `pnpm doctor`.
App: `pnpm --filter @vitls/app keys:generate` (prints a new field key for `.env`).

## 10. Implementation order

1. `packages/health-ingest` (+ tests) → 2. `encrypted.ts` (+ tests) → 3. schema + migrations → 4. pairing/token actions + routes →
5. ingest route (+ tests) → 6. `apps/gccli-sync` → 7. `coach_facts` (after §7 decision) → 8. read actions for the coach/dashboards (next spec).

## 10b. Manual entry (fallback source, 2026-10-01)

When no tracker is connected (or a value has no tracker, e.g. waist), values are entered by hand on the dashboard
("Log value") or told to the coach in chat. Both use the `log-health-data` action, which builds a normal ingest batch with
`provider`/`via` = `"manual"` and runs it through `ingestBatch` (same validation, units, dedupe, encryption, audit) under a
per-user source with device id `manual`. `ingestBatch` rejects `"manual"` from device tokens. Source resolution in
`get-health` ranks `manual` last, so tracker data wins for the same metric and day.

## 11. Security review outcomes (2026-10-01)

Focused review of the pairing/ingest path (security-audit skill, guidance mode). Changes applied:

| Finding | Fix |
|---|---|
| Ingest rate limit counted only committed batches (concurrency, invalid/duplicate bodies bypassed it); raw archive unbounded | Atomic Postgres fixed-window limiter (`rate_limits`, `server/lib/ingest/rate-limit.ts`) counted per device **before** the body is read (60 req/min) + daily byte quota (50 MB/device, charged from Content-Length before reading); body cap 2 MB; retention purge per owner on ingest + `pnpm --filter @vitls/app purge:archives` (also prunes stale `rate_limits` rows) for daily host scheduling |
| Malformed `VITLS_FIELD_KEYS` entry echoed key material in errors/logs | Errors reference the entry index only; production boot check (`server/plugins/field-keys.ts`) |
| Pairing code guessable online (no throttle) | 12-symbol codes (~60 bits), per-client throttle (10/min, keyed on the platform-set client IP — client `X-Forwarded-For` ignored) behind a high global backstop (5000/min, so one attacker cannot lock out pairing), max 5 open codes per user |
| External MCP clients could mint pairing codes | `create-device-pairing`: `mcpTool: false`, `needsApproval: true` |
| Device tokens kept org membership after removal | `isOrgMember` re-checked on every ingest request (inside a request context so federated orgs can validate) |
| Framework offboarding **transfers** `owner_email` rows to another member by default | `registerIdentityColumns` for all health tables: `offboard: "delete"` (org-scoped), `emailChange: "rekey"` |
| Malformed JSON → 500 with request content in logs | `SyntaxError` → 400; unexpected errors log class/code only |
| Overflow after unit conversion, duplicate natural keys in one batch, unbounded dates/session spans | Output-finite check, in-batch dedupe (last wins), timestamp window 2000…now+2d, max sleep 48 h / workout 7 d |
| Device free text reaches the coach LLM | Normalized, not trusted: workout types / exercises / score keys become snake_case identifiers (HealthKit camelCase and Health Connect UPPER_CASE included); device/app/os/appVersion labels are NFC-normalized and stripped to letters, marks, digits and common punctuation (`Amir’s iPhone` stays intact, markup and control characters are removed) |
| GCM accepted short tags | `authTagLength: 16`, IV/ciphertext length checks |
| gccli-sync token handling | `.state/` 0700, atomic 0600 writes, refuses non-HTTPS servers except localhost |

Independent re-verification (fresh agent) confirmed the fixes and found a regression (label regex rejected real device names), a global-throttle lockout lever, and unbounded `rate_limits` growth — all fixed in the same change.

Accepted / open:
- Production (incl. Netlify deploy previews) refuses to boot without `VITLS_FIELD_KEYS`.
- Offboarding a member deletes that person's health rows **in that organization** (their personal org is untouched). Decision (2026-10-01): no export step.
- Ciphertext is bound to `table.column` but not to the row; moving ciphertext between rows requires direct DB write access (no app path). Accepted risk (2026-10-01); revisit if DB write access widens.
- Framework auth guard matches the raw (non-normalised) path, so `…/redeem/../<route>` reaches other routes without the guard; handlers we checked enforce their own auth. Upstream issue draft: `docs/upstream/agent-native-auth-guard-path-normalization.md`.
- Coach-side prompt-injection handling (wrapping device data as untrusted) is part of the coach spec.
