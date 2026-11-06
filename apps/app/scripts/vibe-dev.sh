#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# vibe-dev.sh — Bootstrap a fully autonomous vibecoding session
#
# Ported from quantal/getmedoc2 for apps/app (the VITLS agent-native app):
# one Vite process (`agent-native dev`) serves the React Router SSR frontend
# AND the Nitro/H3 API, so there is a single server, a single port, and a
# single log. No Stripe forwarder, no tunnel — this app has neither.
#
# Starts these cooperating processes:
#   1. `agent-native dev` (Vite + Nitro on :8081 by default; Vite picks the next
#      free port if that one is busy) with output piped to .vibe/server.log via
#      tee — ANSI-stripped for the log copy, colored live in this terminal.
#   2. `tsc --noEmit --watch` — Vite transpiles but does NOT type-check, so this
#      surfaces type errors into the same log (prefixed `typecheck:` so the
#      sensor attributes them). `react-router typegen` runs first so route
#      types exist, exactly like `pnpm typecheck` does.
#   3. scripts/vibe-watch.mjs — the feedback-loop SENSOR. It tails the log,
#      discovers the dev port from Vite's "Local:" line, runs active probes
#      against /_agent-native/ping (liveness), /_agent-native/health (DB
#      readiness) and / (SSR page), and writes one machine-readable beacon:
#      .vibe/status.json.
#
# Claude's loop reads .vibe/status.json (one cheap call), acts only on red /
# degraded, fixes, then re-verifies — running until the log is clear, the
# server meets its latency SLOs, and the app is type-clean.
#
# Usage:
#   pnpm vibe            # or: ./scripts/vibe-dev.sh
#   pnpm vibe:status     # print the current beacon
#
# Env:
#   PORT=8082            # ask Vite for a different port (default 8081; sensor follows the log anyway)
#   VIBE_NO_TYPECHECK=1  # skip the tsc watch
#   VIBE_NO_INFRA=1      # don't touch Docker (infra/docker-compose.yml)
#
# To stop: Ctrl+C (kills Vite, the tee pipe, tsc, and the watcher)
# ─────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VIBE_DIR="$ROOT_DIR/.vibe"

# ── Setup ────────────────────────────────────────────────────
mkdir -p "$VIBE_DIR"

# Fresh logs each session
: > "$VIBE_DIR/server.log"
: > "$VIBE_DIR/errors.jsonl"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VIBE MODE ACTIVE — dev server feedback loop"
echo ""
echo "  Beacon:  .vibe/status.json   (overall + probes + typecheck + SLOs; READ THIS)"
echo "  Errors:  .vibe/errors.jsonl  (structured, classified)"
echo "  Metrics: .vibe/metrics.jsonl (latency time-series)"
echo "  Raw log: .vibe/server.log    (Vite + Nitro + tsc, ANSI-stripped)"
echo ""
echo "  Claude: run /vibe-loop to start autonomous fix + optimize"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$ROOT_DIR"
export PORT="${PORT:-8081}"

# ── Empty provider keys ───────────────────────────────────────
# dotenv never overrides a variable that already exists, so a shell exporting
# ANTHROPIC_API_KEY="" (some agent harnesses do) would hide the key in .env and
# the chat would ask for a key. Drop set-but-empty provider keys first.
for key in ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY; do
  if [ -n "${!key+x}" ] && [ -z "${!key}" ]; then unset "$key"; fi
done

# ── Local infra (Postgres + Mailpit) ─────────────────────────────
# Same stack as `pnpm infra:up` at the repo root. Only used when
# apps/app/.env points DATABASE_URL / MAIL_SMTP_HOST at it; otherwise the app
# runs on PGlite. Docker down → warn and continue on PGlite.
INFRA_COMPOSE="$ROOT_DIR/../../infra/docker-compose.yml"
if [ -f "$INFRA_COMPOSE" ] && [ -z "${VIBE_NO_INFRA:-}" ]; then
  if docker info >/dev/null 2>&1; then
    docker compose -f "$INFRA_COMPOSE" up -d --wait >/dev/null 2>&1 \
      && echo "  + infra up (vitls-postgres :5435, vitls-mailpit :1027 / http://localhost:8027)" \
      || echo "  ! infra failed to start — see: docker compose -f infra/docker-compose.yml ps"
  else
    echo "  ! Docker is not running — skipping infra (app falls back to PGlite unless DATABASE_URL is set)"
  fi
  echo ""
fi

# ── Start the sensor in the background ───────────────────────
node "$ROOT_DIR/scripts/vibe-watch.mjs" &
WATCH_PID=$!

# ── Start the type-check watch in the background ─────────────
# Mirrors `agent-native typecheck` (react-router typegen, then tsc --noEmit)
# but in watch mode, folded into the SAME log with a `typecheck:` prefix.
TSC_PID=""
if [ -z "${VIBE_NO_TYPECHECK:-}" ]; then
  pnpm exec react-router typegen >/dev/null 2>&1 || true
  (
    pnpm exec tsc --noEmit --watch --preserveWatchOutput --pretty false 2>&1 |
      perl -pe 'BEGIN { $| = 1 } s/\x1b\[[0-9;]*[a-zA-Z]//g; s{^}{typecheck: }'
  ) >> "$VIBE_DIR/server.log" &
  TSC_PID=$!
  echo "  + type-check watch running (tsc --noEmit --watch → beacon)"
  echo ""
fi

# Tear down the watcher + tsc (and their children) when this script exits.
cleanup() {
  trap - INT TERM EXIT
  kill "$WATCH_PID" 2>/dev/null || true
  [ -n "$TSC_PID" ] && { pkill -P "$TSC_PID" 2>/dev/null || true; kill "$TSC_PID" 2>/dev/null || true; }
  # kill the whole process group of any remaining children
  pkill -P $$ 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ── Start the dev server with log capture ────────────────────
# `agent-native dev` without --open: a vibe session restarts often and must
# not pop a browser tab each time. Open http://localhost:<port>/home yourself.
# 2>&1        — merge stderr into stdout
# tee >(sed)  — write to log file with ANSI stripped, terminal still gets colored output
pnpm exec agent-native dev 2>&1 | tee >(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' >> "$VIBE_DIR/server.log")
