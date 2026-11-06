#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// vibe-watch.mjs — the autonomous feedback-loop sensor.
//
// Ported from quantal/getmedoc2 for apps/app (the VITLS agent-native app): one
// Vite process (`agent-native dev`) serves the React Router SSR frontend and
// the Nitro/H3 API together, so there is a single server, a single port and
// a single log to watch.
//
// Runs ALONGSIDE the dev server (started by vibe-dev.sh). It is the "eyes" of
// the loop: it never edits code. It continuously turns the messy live dev
// stream into one small, machine-readable beacon that Claude (or a human)
// reads in a single cheap call:
//
//     .vibe/status.json    the beacon — overall green/degraded/red + per-probe
//                          detail + perf percentiles + a monotonic `generation`
//     .vibe/errors.jsonl   structured, de-duplicated error events from the log
//     .vibe/metrics.jsonl  perf time-series (one sample per probe) for trends
//     .vibe/server.log     raw, ANSI-stripped dev output (written by vibe-dev.sh)
//
// What it does, continuously:
//   1. Tails server.log, classifies new lines into structured error events,
//      and tracks lifecycle (Vite ready, port, restarts, tsc errors, Vite
//      transform errors that clear on the next successful HMR update).
//   2. ACTIVE probes: on every reload + on a steady interval it measures
//      latency (p50/p95/p99) and error rate for
//        /_agent-native/ping     — in-process liveness
//        /_agent-native/health   — DB liveness probe (SELECT 1) + readiness
//        /                       — the SSR marketing page (full render path)
//      against SLOs, so "is it fast enough" is a signal, not a guess.
//   3. Composes one `overall` verdict and writes status.json, bumping
//      `generation` only when something meaningful changed.
//
// The loop's exit condition (overall=green) means: server up, 0 type errors,
// no Vite errors, ping/health/page 200, SLOs met, clear log.
//
// Zero dependencies — Node 22+ (global fetch). Run: node scripts/vibe-watch.mjs
// ─────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIBE = path.join(ROOT, '.vibe');

const SERVER_LOG = path.join(VIBE, 'server.log');
const ERRORS_LOG = path.join(VIBE, 'errors.jsonl');
const METRICS_LOG = path.join(VIBE, 'metrics.jsonl');
const STATUS_FILE = path.join(VIBE, 'status.json');
const SLO_FILE = path.join(VIBE, 'slo.json');

// ── Config ─────────────────────────────────────────────────────────────────
// The agent-native Vite plugin defaults to :8080 and Vite moves to the next
// free port when it is taken, so the port is DISCOVERED from Vite's
// "➜  Local:   http://localhost:NNNN/" line. PORT seeds it.
let port = Number(process.env.PORT ?? 8081);
const FRAMEWORK_PREFIX = '/_agent-native';
const base = () => `http://localhost:${port}`;

// SLOs (ms / ratios). Overridable via .vibe/slo.json.
const DEFAULT_SLO = {
  ping: { p95: 50, p99: 100 }, // in-process liveness, no I/O
  health: { p95: 150, p99: 300 }, // one DB round-trip (SELECT 1)
  page: { p95: 500, p99: 1000 }, // SSR render of `/` through the Vite dev pipeline
  bootMs: 15000, // cold boot ceiling (informational)
  errorRate: 0, // 5xx / transport failures tolerated
};
const SLO = { ...DEFAULT_SLO, ...(readJsonSafe(SLO_FILE) ?? {}) };

const INTERVAL_MS = 12_000; // steady perf heartbeat even without reloads
const RELOAD_DEBOUNCE_MS = 1_200; // wait for the server to settle after a reload
const HTTP_TIMEOUT_MS = 8_000; // dev SSR can be slow on the first hit
const PING_SAMPLES = 20;
const HEALTH_SAMPLES = 10;
const PAGE_SAMPLES = 5;

// ── Mutable state ────────────────────────────────────────────────────────────
const state = {
  generation: 0,
  server: { up: false, bootMs: null, lastStartedAt: null, startingAt: Date.now(), restarts: 0 },
  compile: { ok: true, errorCount: 0, errors: [] },
  viteErrors: [],
  recentErrors: [],
};
let lastBeaconHash = '';
let logOffset = 0;
let logRemainder = '';
let probing = false;
let reloadTimer = null;

// ── Small utils ───────────────────────────────────────────────────────────────
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}
function readJsonSafe(p) {
  const raw = readFileSafe(p);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function nowIso() {
  return new Date().toISOString();
}
function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}
function appendLine(file, obj) {
  try {
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch {
    /* never let logging crash the daemon */
  }
}

// ── Log classification ─────────────────────────────────────────────────────────
// Each rule turns a raw line into a structured event. Order = priority.
// The log carries three voices: Vite (`[vite]`, `➜  Local:`), Nitro/H3 and app
// server code (plain lines), and the tsc watch (prefixed `typecheck:`).
const RULES = [
  // lifecycle
  { kind: 'boot.port', sev: 'info', re: /Local:\s+http:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]):(\d+)/ },
  { kind: 'boot.done', sev: 'info', re: /VITE v[\d.]+\s+ready in|ready in \d+\s*ms/i },
  { kind: 'boot.restart', sev: 'info', re: /\[vite\](?: \([\w-]+\))? server restarted|restarting server/i },
  { kind: 'hmr.ok', sev: 'info', re: /\[vite\](?: \([\w-]+\))? (?:hmr update|page reload|connected)/i },
  // typecheck watch (tsc --noEmit --watch, prefixed by vibe-dev.sh)
  { kind: 'tsc.start', sev: 'info', re: /^typecheck: .*Starting compilation in watch mode/ },
  { kind: 'tsc.summary', sev: 'info', re: /^typecheck: .*Found (\d+) errors?\. Watching/ },
  { kind: 'type.error', sev: 'error', re: /^typecheck: .*error TS\d+/ },
  // errors
  { kind: 'env.missing', sev: 'error', re: /Environment variable not found:|Missing required env/i },
  { kind: 'db.refused', sev: 'error', re: /ECONNREFUSED.*:5432|:5432.*ECONNREFUSED|password authentication failed|database .* does not exist/i },
  { kind: 'db.error', sev: 'error', re: /PostgresError|relation .* does not exist|migration .* failed/i },
  { kind: 'module.missing', sev: 'error', re: /Cannot find module|Module not found|Failed to resolve import|Failed to load url/i },
  { kind: 'vite.error', sev: 'error', re: /\[vite\][^\n]*(?:error|failed)|Internal server error|Pre-transform error|error during build|\[plugin:[^\]]+\]|✘ \[ERROR\]/i },
  { kind: 'port.busy', sev: 'error', re: /EADDRINUSE|Port \d+ is already in use/i },
  { kind: 'server.error', sev: 'error', re: /\[nitro\]\s*(?:error|✖)|\[h3\]\s*(?:error|✖)|UnhandledPromiseRejection|UnhandledRejection|\bERROR\b/ },
  { kind: 'exception', sev: 'error', re: /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/ },
  { kind: 'process.fail', sev: 'error', re: /ELIFECYCLE|exited with (?:code )?[1-9]/ },
  { kind: 'crash', sev: 'error', re: /FATAL|Segmentation fault|out of memory/i },
];

let lastClassifyKey = '';
function classifyLine(line) {
  const clean = line.trim();
  if (!clean) return;
  for (const rule of RULES) {
    const m = rule.re.exec(clean);
    if (!m) continue;
    handleLifecycle(rule.kind, m, clean);
    if (rule.sev === 'error') {
      const loc = /([\w./@-]+\.(?:tsx?|jsx?|mjs|css)):?\(?(\d+)[,:](\d+)/.exec(clean);
      const evt = {
        ts: nowIso(),
        kind: rule.kind,
        severity: rule.sev,
        message: clean.replace(/^typecheck:\s*/, '').slice(0, 500),
        ...(loc ? { file: loc[1], line: Number(loc[2]), col: Number(loc[3]) } : {}),
      };
      const key = `${rule.kind}|${evt.file ?? ''}|${evt.message}`;
      if (key !== lastClassifyKey) {
        appendLine(ERRORS_LOG, evt);
        lastClassifyKey = key;
      }
      pushRecentError(evt);
    }
    return; // first matching rule wins
  }
}

function handleLifecycle(kind, m, clean) {
  switch (kind) {
    case 'boot.port': {
      const discovered = Number(m[1]);
      if (discovered && discovered !== port) {
        port = discovered;
        console.log(`[vibe-watch] dev server port → ${port}`);
      }
      scheduleReloadProbe();
      break;
    }
    case 'boot.done':
      if (state.server.startingAt) state.server.bootMs = Date.now() - state.server.startingAt;
      state.server.up = true;
      state.server.lastStartedAt = nowIso();
      state.viteErrors = [];
      scheduleReloadProbe();
      break;
    case 'boot.restart':
      state.server.restarts += 1;
      state.server.startingAt = Date.now();
      scheduleReloadProbe();
      break;
    case 'hmr.ok':
      // A successful hot update means the last transform error is resolved.
      state.server.up = true;
      state.viteErrors = [];
      scheduleReloadProbe();
      break;
    case 'tsc.summary': {
      const n = Number(m[1]);
      state.compile.errorCount = n;
      state.compile.ok = n === 0;
      if (n === 0) state.compile.errors = [];
      scheduleReloadProbe();
      break;
    }
    case 'tsc.start':
      state.compile.errors = [];
      break;
    case 'type.error':
      state.compile.ok = false;
      if (state.compile.errors.length < 10) state.compile.errors.push(clean.replace(/^typecheck:\s*/, '').slice(0, 300));
      break;
    case 'vite.error':
    case 'module.missing': {
      const msg = clean.slice(0, 300);
      state.viteErrors = [msg, ...state.viteErrors.filter((e) => e !== msg)].slice(0, 5);
      break;
    }
    default:
      break;
  }
}

function pushRecentError(evt) {
  state.recentErrors = [evt, ...state.recentErrors.filter((e) => e.message !== evt.message)].slice(0, 8);
}

// ── Log tailing ──────────────────────────────────────────────────────────────
// Serialized: many triggers (fs.watch, poll, probe) call drainLog concurrently;
// without a lock they race on logOffset/logRemainder and drop lines.
let draining = false;
let drainPending = false;
async function drainLog() {
  if (draining) {
    drainPending = true;
    return;
  }
  draining = true;
  try {
    await drainOnce();
  } finally {
    draining = false;
    if (drainPending) {
      drainPending = false;
      void drainLog();
    }
  }
}

async function drainOnce() {
  let stat;
  try {
    stat = await fsp.stat(SERVER_LOG);
  } catch {
    return; // log not created yet
  }
  if (stat.size < logOffset) {
    // truncated (new session) → reset
    logOffset = 0;
    logRemainder = '';
  }
  if (stat.size === logOffset) return;
  const stream = fs.createReadStream(SERVER_LOG, { start: logOffset, end: stat.size - 1, encoding: 'utf8' });
  let chunk = '';
  for await (const part of stream) chunk += part;
  logOffset = stat.size;
  const text = logRemainder + chunk;
  const lines = text.split('\n');
  logRemainder = lines.pop() ?? '';
  for (const line of lines) classifyLine(line);
}

// ── HTTP probing ───────────────────────────────────────────────────────────────
async function timedFetch(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { redirect: 'manual', ...opts, signal: ac.signal });
    await res.arrayBuffer(); // drain body so timing includes full response
    // 3xx counts as answered: the SSR root may redirect a signed-in dev account.
    const ok = res.status >= 200 && res.status < 400;
    return { ms: performance.now() - start, status: res.status, ok };
  } catch (err) {
    return { ms: performance.now() - start, status: 0, ok: false, error: String(err?.name ?? err) };
  } finally {
    clearTimeout(t);
  }
}

async function sampleEndpoint(url, n, opts) {
  // 2 warm-up requests (excluded), then n measured — sequential to avoid
  // self-inflicted contention skewing the latency signal.
  await timedFetch(url, opts).catch(() => {});
  await timedFetch(url, opts).catch(() => {});
  const samples = [];
  let failures = 0;
  let lastStatus = 0;
  for (let i = 0; i < n; i++) {
    const r = await timedFetch(url, opts);
    lastStatus = r.status;
    if (!r.ok) failures += 1;
    else samples.push(r.ms);
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    status: lastStatus,
    ok: failures === 0 && sorted.length > 0,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
    errorRate: Number((failures / n).toFixed(3)),
  };
}

// /_agent-native/health answers 200 with { ok, ready, db, dbTimedOut?, ... }.
// Latency comes from sampling; readiness comes from one body read.
async function readHealthBody() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
    const res = await fetch(`${base()}${FRAMEWORK_PREFIX}/health`, { signal: ac.signal });
    clearTimeout(t);
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function sloVerdict(probe, target) {
  if (!probe.ok) return 'fail';
  const violations = [];
  if (target.p95 != null && probe.p95 != null && probe.p95 > target.p95) violations.push(`p95 ${probe.p95}ms > ${target.p95}ms`);
  if (target.p99 != null && probe.p99 != null && probe.p99 > target.p99) violations.push(`p99 ${probe.p99}ms > ${target.p99}ms`);
  if (probe.errorRate > SLO.errorRate) violations.push(`errorRate ${probe.errorRate} > ${SLO.errorRate}`);
  return violations.length ? violations : 'pass';
}

async function runProbe(trigger) {
  if (probing) return;
  probing = true;
  try {
    await drainLog();
    const ping = await sampleEndpoint(`${base()}${FRAMEWORK_PREFIX}/ping`, PING_SAMPLES);
    // Only probe deeper layers if liveness answered — avoids noise during boot.
    const health = ping.ok ? await sampleEndpoint(`${base()}${FRAMEWORK_PREFIX}/health`, HEALTH_SAMPLES) : { ok: false, status: 0, errorRate: 1 };
    const healthBody = ping.ok ? await readHealthBody() : null;
    const page = ping.ok ? await sampleEndpoint(`${base()}/`, PAGE_SAMPLES) : { ok: false, status: 0, errorRate: 1 };

    // Fallback boot detection: if the log lifecycle line was missed but the
    // server now answers, still record that it came up.
    const cameUp = ping.ok && !state.server.up;
    state.server.up = ping.ok;
    if (cameUp) {
      if (!state.server.lastStartedAt) state.server.lastStartedAt = nowIso();
      if (state.server.bootMs == null && state.server.startingAt) state.server.bootMs = Date.now() - state.server.startingAt;
    }

    const ready = healthBody ? healthBody.ready !== false && healthBody.db !== false : false;
    const readiness = {
      ready,
      db: healthBody?.db ?? null,
      dbTimedOut: healthBody?.dbTimedOut ?? false,
      realtime: healthBody?.realtime ?? null,
    };

    const pingSlo = sloVerdict(ping, SLO.ping);
    const healthSlo = health.ok ? sloVerdict(health, SLO.health) : 'fail';
    const pageSlo = page.ok ? sloVerdict(page, SLO.page) : 'fail';

    const perf = composePerf({ pingSlo, healthSlo, pageSlo });
    const beacon = composeStatus({ trigger, ping, health, readiness, page, pingSlo, healthSlo, pageSlo, perf });
    writeStatus(beacon);

    appendLine(METRICS_LOG, {
      ts: nowIso(),
      trigger,
      bootMs: state.server.bootMs,
      ping: { p50: ping.p50, p95: ping.p95, p99: ping.p99, errorRate: ping.errorRate },
      health: { p50: health.p50, p95: health.p95, p99: health.p99, errorRate: health.errorRate },
      page: { p50: page.p50, p95: page.p95, p99: page.p99, errorRate: page.errorRate },
    });
  } catch (err) {
    // never crash the daemon on a probe failure
    appendLine(ERRORS_LOG, { ts: nowIso(), kind: 'watch.probe_error', severity: 'warn', message: String(err) });
  } finally {
    probing = false;
  }
}

// ── Status composition ─────────────────────────────────────────────────────────
function composePerf(slos) {
  const violations = [];
  for (const [name, verdict] of Object.entries(slos)) {
    if (Array.isArray(verdict)) {
      const probeName = name.replace('Slo', '');
      verdict.forEach((v) => violations.push(`${probeName}: ${v}`));
    }
  }
  // NB: cold boot time is informational only (see buildAdvice) — a one-time
  // cold start must not pin the system to "degraded" while warm reloads are
  // fast. Request latency is what drives the perf verdict.
  return { verdict: violations.length ? 'slow' : 'optimal', violations };
}

function buildAdvice({ ping, health, readiness, page, perf }) {
  const advice = [];
  if (!state.server.up) advice.push(`dev server not answering on ${base()} — check server.log tail for the boot/crash reason (port conflict? bad plugin?).`);
  if (state.compile.errorCount > 0) advice.push(`${state.compile.errorCount} type error(s) — fix before anything else (see compile.errors; Vite won't flag these, tsc does).`);
  if (state.viteErrors.length) advice.push('Vite transform/import error (see viteErrors) — fix the named module; clears on the next successful HMR update.');
  if (ping.ok && !health.ok) advice.push('/_agent-native/health failing while /ping ok → server-side probe threw; read server.log.');
  if (ping.ok && health.ok && !readiness.ready)
    advice.push(
      readiness.dbTimedOut
        ? 'DB probe timed out → Postgres unreachable or hung (pnpm infra:up? DATABASE_URL right? PGlite lock from a crashed dev server?).'
        : 'health reports not ready → DB down or schema mismatch (Postgres up? migrations applied on boot?).',
    );
  if (ping.ok && !page.ok) advice.push(`GET / returned ${page.status} → the SSR render path is throwing; read recentErrors / server.log for the stack.`);
  if (ping.ok && ping.p95 != null && ping.p95 > SLO.ping.p95)
    advice.push(`/ping p95 ${ping.p95}ms over ${SLO.ping.p95}ms → global middleware/plugin overhead on the hot path.`);
  if (health.ok && health.p95 != null && health.p95 > SLO.health.p95)
    advice.push(`/health p95 ${health.p95}ms over ${SLO.health.p95}ms → DB round-trip slow (connection, pool, PGlite vs Postgres).`);
  if (page.ok && page.p95 != null && page.p95 > SLO.page.p95)
    advice.push(`GET / p95 ${page.p95}ms over ${SLO.page.p95}ms → SSR loader/render cost on the marketing page.`);
  if (state.server.bootMs != null && state.server.bootMs > SLO.bootMs)
    advice.push(`cold boot ${state.server.bootMs}ms over ${SLO.bootMs}ms (informational — warm HMR reloads should be sub-second).`);
  const clean = state.server.up && state.compile.ok && state.viteErrors.length === 0 && ping.ok && health.ok && readiness.ready && page.ok;
  if (perf.verdict === 'optimal' && clean) advice.push('All green: log clear, SLOs met, app ready. Nothing to do.');
  return advice;
}

function composeStatus({ trigger, ping, health, readiness, page, pingSlo, healthSlo, pageSlo, perf }) {
  const hardRed =
    !state.server.up ||
    !state.compile.ok ||
    state.viteErrors.length > 0 ||
    !ping.ok ||
    !health.ok ||
    !readiness.ready ||
    !page.ok;
  const overall = hardRed ? 'red' : perf.verdict === 'slow' ? 'degraded' : 'green';

  const summaryBits = [];
  summaryBits.push(state.server.up ? `up :${port}` : 'DOWN');
  if (!state.compile.ok) summaryBits.push(`${state.compile.errorCount} ts err`);
  if (state.viteErrors.length) summaryBits.push('vite ERR');
  if (ping.ok) summaryBits.push(`ping p95 ${ping.p95}ms`);
  if (health.ok) summaryBits.push(readiness.ready ? `health p95 ${health.p95}ms` : 'NOT READY');
  if (ping.ok) summaryBits.push(page.ok ? `page p95 ${page.p95}ms` : `page ${page.status}`);
  if (perf.verdict === 'slow') summaryBits.push('SLOW');

  return {
    generation: state.generation, // bumped in writeStatus on change
    ts: nowIso(),
    overall,
    summary: summaryBits.join(' · '),
    trigger,
    baseUrl: base(),
    server: { ...state.server, port },
    compile: { ...state.compile },
    viteErrors: [...state.viteErrors],
    ping: { ...ping, slo: pingSlo },
    health: { ...health, slo: healthSlo, ...readiness },
    page: { ...page, slo: pageSlo },
    perf,
    slo: SLO,
    recentErrors: state.recentErrors,
    advice: buildAdvice({ ping, health, readiness, page, perf }),
  };
}

function writeStatus(beacon) {
  // Bump generation only when something meaningful changed (cheap change-detection
  // for the loop). Exclude volatile fields (ts, exact ms) from the hash.
  const stable = JSON.stringify({
    overall: beacon.overall,
    summary: beacon.summary.replace(/p95 \d+ms/g, 'p95'),
    serverUp: beacon.server.up,
    port,
    compile: beacon.compile,
    vite: beacon.viteErrors,
    pingOk: beacon.ping.ok,
    pingSlo: beacon.ping.slo,
    healthOk: beacon.health.ok,
    healthSlo: beacon.health.slo,
    ready: beacon.health.ready,
    pageOk: beacon.page.ok,
    pageStatus: beacon.page.status,
    pageSlo: beacon.page.slo,
    perf: beacon.perf.verdict,
    errors: beacon.recentErrors.map((e) => e.message),
  });
  if (stable !== lastBeaconHash) {
    state.generation += 1;
    lastBeaconHash = stable;
  }
  beacon.generation = state.generation;
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(beacon, null, 2));
  } catch {
    /* ignore */
  }
}

// ── Schedulers ──────────────────────────────────────────────────────────────────
function scheduleReloadProbe() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => runProbe('reload').catch(() => {}), RELOAD_DEBOUNCE_MS);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  await fsp.mkdir(VIBE, { recursive: true });
  // fresh structured artifacts each session (server.log is owned by vibe-dev.sh)
  await fsp.writeFile(ERRORS_LOG, '').catch(() => {});
  await fsp.writeFile(METRICS_LOG, '').catch(() => {});

  // Reset the beacon so the loop never acts on a stale status.json from a
  // previous session before the first probe lands.
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify(
        { generation: 0, ts: nowIso(), overall: 'booting', summary: 'sensor online · awaiting first probe', server: { up: false }, baseUrl: base() },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }

  console.log(`[vibe-watch] sensor online → ${base()} (port follows Vite's "Local:" line)`);
  console.log(`[vibe-watch] SLO: ping p95<${SLO.ping.p95}ms · health p95<${SLO.health.p95}ms · page p95<${SLO.page.p95}ms · boot<${SLO.bootMs}ms`);

  // tail the log: fs.watch for liveness + a steady poll as a safety net
  try {
    fs.watch(SERVER_LOG, () => drainLog().catch(() => {}));
  } catch {
    /* server.log appears once vibe-dev writes it */
  }
  setInterval(() => drainLog().catch(() => {}), 600);

  // steady perf heartbeat so "is it fast" stays measured even when idle
  setInterval(() => runProbe('interval').catch(() => {}), INTERVAL_MS);

  // first probe shortly after start (the server may already be up)
  setTimeout(() => runProbe('startup').catch(() => {}), 2500);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
main().catch((err) => {
  console.error('[vibe-watch] fatal', err);
  process.exit(1);
});
