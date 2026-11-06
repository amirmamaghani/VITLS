---
name: vibe-loop
description: Autonomous dev-server feedback loop for apps/app — reads the apps/app/.vibe/status.json beacon, fixes red, optimizes degraded, runs until the log is clear, the app is type-clean, and the server meets its latency SLOs. Use when starting a vibecoding session or when the user says "vibe", "watch for errors", or "autonomous mode".
user_invocable: true
---

# Vibe Loop — Autonomous Fix-and-Optimize Feedback Loop

Scope: **`apps/app`** (the VITLS agent-native app). All paths below are relative to `apps/app/` unless absolute.

You are the **actor** of the feedback loop; `apps/app/scripts/vibe-watch.mjs` (started by `pnpm vibe` from the repo root, via `scripts/vibe-dev.sh`) is the **sensor**. The sensor never edits code — it watches the single `agent-native dev` process (Vite serving the React Router SSR frontend **and** the Nitro/H3 API on one port, default `:8081`) plus a `tsc --noEmit --watch`, runs active probes, and writes one machine-readable beacon. You read that beacon, act only when it is not green, and loop until the log is clear, the app is type-clean, and the server meets its latency SLOs.

**Do not tail `server.log` every iteration.** That is the old, expensive way. Read the beacon — one small file — and only drill into raw logs when the beacon says something is red.

## The beacon — your single source of truth

`apps/app/.vibe/status.json` (read it with `cat apps/app/.vibe/status.json` or `pnpm vibe:status` from the repo root):

```jsonc
{
  "generation": 7,            // monotonic; bumps ONLY when something changed
  "overall": "green",         // booting | green | degraded | red
  "summary": "up :8081 · ping p95 1ms · health p95 4ms · page p95 120ms",
  "baseUrl": "http://localhost:8081",                                                   // port follows Vite's "Local:" line
  "server":  { "up": true, "port": 8081, "bootMs": 3200, "restarts": 0 },
  "compile": { "ok": true, "errorCount": 0, "errors": [] },                             // tsc --noEmit --watch
  "viteErrors": [],                                                                     // transform/import/plugin errors; clear on next good HMR
  "ping":    { "ok": true, "status": 200, "p95": 1, "errorRate": 0, "slo": "pass" },   // /_agent-native/ping — in-process liveness
  "health":  { "ok": true, "status": 200, "p95": 4, "slo": "pass",
               "ready": true, "db": true, "dbTimedOut": false },                        // /_agent-native/health — DB SELECT 1 + readiness
  "page":    { "ok": true, "status": 200, "p95": 120, "slo": "pass" },                  // GET / — the chat app's SSR root page
  "perf":    { "verdict": "optimal", "violations": [] },                                // optimal | slow
  "recentErrors": [ /* last 8 classified errors */ ],
  "advice":  [ /* targeted next-step hints */ ]
}
```

Supporting files (read **only when drilling into a problem**):
- `.vibe/errors.jsonl` — structured, de-duplicated error events (kind, severity, message, file, line).
- `.vibe/metrics.jsonl` — latency time-series (one sample per probe); read to see a perf trend.
- `.vibe/server.log` — raw ANSI-stripped dev output (Vite + Nitro + `typecheck:`-prefixed tsc); the last resort for a stack trace the beacon didn't capture.

## The loop

Each iteration:

1. **Read the beacon** (`cat apps/app/.vibe/status.json`).
2. **Compare `generation`** to the last one you saw. If unchanged → nothing happened → stay silent and wait. If changed → evaluate `overall`.
3. **Branch on `overall`:**

| `overall` | Meaning | Your action |
|---|---|---|
| `booting` | Sensor online, first probe not in yet | Wait. |
| `green` | Up · 0 type errors · no Vite errors · ping/health/page 200 · DB ready · SLOs met · log clear | **Done / steady state.** Say nothing, keep monitoring. This is the exit condition. |
| `degraded` | Functional but a latency SLO is violated (`perf.verdict: "slow"`) | **OPTIMIZE** (below). |
| `red` | Server down, type/Vite errors, a probe failing, DB not ready, or `/` erroring | **FIX** (below). |

4. After any edit, **do not blind-sleep**. Vite hot-reloads on save and the sensor re-probes automatically. **Wait for `generation` to increment**, then re-read the beacon to verify. (Poll the beacon a few times, ~3–5s apart; an HMR update + probe lands within a couple of seconds.)

### FIX mode (`overall: red`)

Resolve in this severity order (most blocking first):

1. **Server down** (`server.up: false`) → read `recentErrors`, then the tail of `.vibe/server.log`. Usual causes: a port conflict (`EADDRINUSE`), a Vite/Nitro plugin throwing at boot, a bad import in `server/plugins/*`, or a failing migration in `server/db`.
2. **Type errors** (`compile.ok: false`) → `compile.errors` has the messages; each event in `errors.jsonl` carries `file`/`line`. Read the file around the line, fix minimally. If route types are stale, `pnpm exec react-router typegen` regenerates them.
3. **Vite errors** (`viteErrors` non-empty) → an unresolved import, bad JSX/CSS, or a plugin failure. Fix the named module; it clears on the next successful HMR update.
4. **DB not ready** (`health.ready: false`) → `health.dbTimedOut: true` means Postgres is unreachable (without `DATABASE_URL` this is PGlite in `apps/app/data/` — a stale lock from a crashed dev server is the usual cause; with `DATABASE_URL` set, is `vitls-postgres` up (`pnpm postgres`) and the port 5435? — see the `infra` skill); otherwise the schema/migrations failed on boot. Do **not** silently change the schema — escalate (see below).
5. **`/` failing** (`page.ok: false`) → the SSR render path is throwing: a loader, a server plugin, or a component that only breaks on the server. `recentErrors` usually has the stack; otherwise reproduce with `curl -s localhost:<port>/ | head`.
6. **Ping/health 5xx or errorRate > 0** → a middleware or plugin is throwing on a healthy path; read `server/middleware` and `server/plugins`.

Then: save → wait for `generation` to bump → confirm `overall` improved.

### OPTIMIZE mode (`overall: degraded`)

The app works but is too slow per its SLOs. This is the "continuously optimize until optimal" half of the loop.

1. Read `perf.violations` and `advice` — they name the slow probe and the likely cause.
2. Read the `.vibe/metrics.jsonl` tail to see whether it is a steady regression or a one-off spike (ignore single spikes; act on a sustained trend). The first request after an HMR update is always slow — that is Vite, not you.
3. Apply a **targeted** fix matched to the violation:
   - `/ping` slow → overhead on the hot path: a server middleware or plugin doing real work per request, synchronous logging.
   - `/health` slow → the DB round-trip: connection setup, pool size, PGlite vs Postgres, a slow network to a hosted DB.
   - `/` slow → SSR cost on the root page: a heavy loader, unawaited data fetched serially, large component trees rendered server-side.
4. Save → wait for `generation` to bump → confirm `perf.verdict` returned to `optimal`.

Cold `bootMs` over its threshold is reported as **informational advice only** — it does not make the system `degraded`. Warm HMR reloads are what should stay fast; do not chase a one-time cold-start number.

SLOs can be tuned per machine in `.vibe/slo.json` (same keys as the beacon's `slo` block).

## Escalation — STOP and ask the human when

| Condition | Ask |
|---|---|
| Same red after 3 different fix attempts | Show what you tried, your root-cause theory, and 2–3 options |
| A latency SLO can't be met without an architectural change | Describe the bottleneck and propose the change before doing it |
| Product/design decision required | "This looks intentional — should X do Y or Z?" |
| Missing env var | "I need `VAR` in .env — what value?" (never invent secrets) |
| Missing dependency | "Should I install `pkg`?" (do **not** auto-install) |
| DB schema change needed | "Schema out of sync — add a migration under `server/db`?" |
| Error in a file you didn't touch | "Pre-existing error in `file.ts` — fix it?" |
| Error inside `node_modules/@agent-native/*` | Never patch the package — report it with the installed version (`grep '"@agent-native/core"' apps/app/package.json`) |

Escalation format:
```
⚠️ STUCK — [overall] · [probe/area]
Attempts: [N/3]
Beacon: [summary line]
Tried: 1) … 2) … 3) …
Best guess: [root cause]
Options: A) … B) … C) skip
```

## Hard rules

1. **Beacon first.** Read `.vibe/status.json`; only open `errors.jsonl` / `server.log` to drill into a specific red.
2. **Act on change, not on a clock.** Use `generation` to detect change; if it didn't change, do nothing.
3. **Verify by re-probe, not by sleep.** After an edit, wait for `generation` to increment and re-read — the sensor probes the live server for you.
4. **Minimal, targeted edits.** Fix the error / the named bottleneck; don't refactor around it.
5. **One thing at a time**, worst-first (down > types > vite > DB > page > perf).
6. **Never** auto-install packages, edit `.env`, change the DB schema, or patch `@agent-native/*` — escalate.
7. **Match existing code style** in any file you edit, and keep the framework contract from `apps/app/CLAUDE.md` / `AGENTS.md` (actions first, data in SQL).
8. **Exit condition = `overall: green`** (log clear + SLOs met). When green, stop acting and keep silently monitoring.

## Starting the loop

`pnpm vibe` (repo root) runs `apps/app/scripts/vibe-dev.sh`: it first brings
up the Docker stack (`infra/docker-compose.yml` — `vitls-postgres` :5435,
`vitls-mailpit` :1027/:8027, see the `infra` skill; Docker down → warning,
app stays on PGlite; `VIBE_NO_INFRA=1` skips it), then the dev server, a
`tsc --noEmit --watch`, and the sensor. Whether the app actually uses Postgres
depends on `DATABASE_URL` in `apps/app/.env`. Stop it with Ctrl+C in that terminal; if it was backgrounded, kill only
processes whose cwd is inside this repo (see the `infra` skill) — other repos on
this machine run their own `vibe-watch.mjs` / `agent-native dev`.

```bash
# Sensor running? (started by `pnpm vibe` in another terminal)
cat apps/app/.vibe/status.json >/dev/null 2>&1 && echo "✓ beacon present" || echo "✗ run pnpm vibe first"
```

Then drive the loop with `/loop` (self-paced): each tick reads the beacon and acts only if `overall` ≠ green and `generation` changed. Keep going until the beacon is green and stays green.
