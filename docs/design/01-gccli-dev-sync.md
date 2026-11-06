# Design: `gccli` dev sync (development-only Garmin source)

Status: **APPROVED** (ingest-endpoint path, not direct DB) · 2026-10-01

## Goal

Get real Garmin data into a local/dev VITLS instance **before** the companion app exists, while exercising
**exactly the same access path** the companion app will use in production. The tool is a stand-in for the
companion, not a back door.

## Non-goals

- Not a production integration (Garmin ToS — see `docs/research/05-garmin-and-companion-app.md`). Never deployed, never offered to users.
- No direct database writes.

## Why not write straight to the DB

A direct DB write would bypass everything we actually need to test: device pairing, user-scoped write tokens,
org scoping, payload validation, dedupe, audit, and change notifications. It would also need DB credentials on the
tool's side. The dev tool therefore talks to the **same ingest endpoint** as the companion.

## Shape

```
gccli (user's own Garmin login, browser SSO flow, tokens stay on the dev machine)
   │  JSON (gccli --json ...)
   ▼
apps/gccli-sync  (Node/TS CLI, dev-only)
   │  map → canonical ingest payload (shared zod schema)
   │  HTTPS + device token (same as companion)
   ▼
apps/app  POST /api/ingest/v1/batches   → validate → org/user scope → dedupe upsert → audit → change event
```

### Components

| Piece | Where | Notes |
|---|---|---|
| Canonical ingest payload schema (zod) | `packages/health-ingest` | Shared by `apps/app` (validate), `apps/companion` (build), `apps/gccli-sync` (build). Three consumers → package is justified. Modelled on Open Wearables: `{ records[], sleep[], workouts[] }`, each item with stable `externalId`, type, start/end, zone offset, value + unit, `source { provider, app, device, via }`. |
| Pairing action | `apps/app/actions/create-device-pairing.ts` | agent-native action → callable from the PWA UI **and** from CLI (`pnpm action create-device-pairing`). Returns a short-lived one-time code. |
| Pair-redeem + ingest endpoints | `apps/app/server/routes/api/ingest/v1/*` | Device-facing HTTP routes (allowed category: device/webhook ingest). Redeem code → user-scoped, write-only device token (hashed at rest, revocable, rotated via refresh). |
| Dev sync CLI | `apps/gccli-sync` | `pair <code>` · `sync [--since YYYY-MM-DD] [--types ...]` · `status`. Local per-type cursors (like companion anchors) in a git-ignored state file. Runs gccli as a child process with `--json`. |

### Data mapped from gccli (v1 of the tool)

Weigh-ins / body composition, daily summary (steps, active kcal, RHR), sleep, HRV, activities (+ exercise sets),
VO2max / max metrics, and Garmin-only series (body battery, stress, training readiness, training status) as
provider-specific series — useful for designing widgets with real data.

### Guard rails

- Every item carries `source.via = "gccli-dev"`.
- Ingest **rejects** `via = "gccli-dev"` unless the server runs with `VITLS_ENABLE_DEV_SOURCES=1` (never set in production).
- The tool has no DB credentials and no server secrets — only its device token.
- Garmin tokens stay in gccli's own keyring on the developer's machine; VITLS never sees them.
- Package is `private`, excluded from deploy targets.

## Order of work (proposal)

1. `packages/health-ingest` schema (+ unit tests) — this is also step 1 of the real data model.
2. Pairing action + redeem/ingest routes + storage tables in `apps/app` (under `agent-native-first`).
3. `apps/gccli-sync` CLI.
4. Later: companion app reuses 1 and 2 unchanged.

## Decisions

- Location: `apps/gccli-sync` (no workspace change).
- Manual `sync` plus `sync --watch <interval>` to mimic background delivery.
- Scripts: per-app `pair`, `sync`, `sync:watch`, `status`; root aliases `pnpm gccli:pair`, `pnpm gccli:sync`, `pnpm gccli:watch`, `pnpm gccli:status`.
  Pairing code from CLI: root alias `pnpm pair:code` → `pnpm --filter @vitls/app action create-device-pairing`.
