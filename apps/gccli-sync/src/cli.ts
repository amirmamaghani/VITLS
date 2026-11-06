/**
 * VITLS gccli dev sync — a stand-in for the companion app during development.
 * It pairs and ingests through exactly the same contract as the companion: never touches the database.
 *
 *   pnpm gccli:pair <CODE> [--server http://localhost:8080]
 *   pnpm gccli:sync [--since YYYY-MM-DD | --days N]
 *   pnpm gccli:watch [--every MINUTES]
 *   pnpm gccli:status
 */
import { parseArgs } from "node:util";

import type { IngestBatchInput } from "@vitls/health-ingest";

import { gccli, gccliAuthStatus } from "./gccli";
import { buildDayBatch, mapActivities, mapWeighIns } from "./map";
import { loadState, saveState, type SyncState } from "./state";

const DEFAULT_SERVER = process.env.VITLS_SERVER ?? "http://localhost:8080";
const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    since: { type: "string" },
    days: { type: "string" },
    watch: { type: "boolean", default: false },
    every: { type: "string", default: "30" },
  },
});

/** The device token travels with every request: only HTTPS, or plain HTTP to this machine. */
function assertSafeServer(server: string): string {
  const url = new URL(server);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`Refusing to send a device token to ${url.origin}: use https:// (plain http is allowed only for localhost)`);
  }
  return url.origin;
}

async function pair(code: string | undefined) {
  if (!code) throw new Error("Usage: pnpm gccli:pair <CODE>  (get a code with `pnpm pair:code`)");
  const server = assertSafeServer(values.server ?? DEFAULT_SERVER);
  const res = await fetch(`${server}/api/devices/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device: { platform: "cli", model: "gccli-sync" } }),
  });
  const body = (await res.json()) as { token?: string; deviceId?: string; error?: string };
  if (!res.ok || !body.token || !body.deviceId) throw new Error(`Pairing failed (${res.status}): ${body.error ?? "unknown error"}`);
  await saveState({ server, token: body.token, deviceId: body.deviceId });
  console.log(`Paired with ${server} as device ${body.deviceId}. Next: pnpm gccli:sync`);
}

async function push(state: SyncState, batch: IngestBatchInput, label: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${state.server}/api/ingest/v1/batches`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${state.token}` },
      body: JSON.stringify(batch),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.status === 429 && attempt < 3) {
      console.log(`  … rate limited, waiting 60 s`);
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }
    if (!res.ok) throw new Error(`${label}: ingest failed (${res.status}) ${JSON.stringify(body).slice(0, 500)}`);
    console.log(`  ✓ ${label} ${JSON.stringify(body.stored)}${body.skipped && (body.skipped as { intraday: number }).intraday ? ` skipped ${JSON.stringify(body.skipped)}` : ""}`);
    return;
  }
}

async function sync(state: SyncState) {
  assertSafeServer(state.server);
  const today = isoDay(Date.now());
  const start = values.since ?? (state.cursor ? isoDay(Date.parse(state.cursor) - DAY_MS) : isoDay(Date.now() - (Number(values.days ?? 7) - 1) * DAY_MS));
  console.log(`Syncing Garmin ${start} → ${today} to ${state.server}`);

  for (let ms = Date.parse(start); ms <= Date.parse(today); ms += DAY_MS) {
    const date = isoDay(ms);
    const [summary, sleep, hrv, readiness, hr, stress] = await Promise.all([
      gccli("health", "summary", date),
      gccli("health", "sleep", date),
      gccli("health", "hrv", date),
      gccli("health", "training-readiness", date),
      gccli("health", "hr", date),
      gccli("health", "stress", "view", date),
    ]);
    await push(state, buildDayBatch({ date, summary, sleep, hrv, readiness, hr, stress }), date);
  }

  const source = { provider: "garmin", via: "gccli-dev", app: "gccli" } as const;
  const points = mapWeighIns(await gccli("body", "weigh-ins", "--start", start, "--end", today));
  if (points.length) await push(state, { batchId: crypto.randomUUID(), sentAt: new Date().toISOString(), source, points }, "weigh-ins");
  const activities = ((await gccli<any[]>("activities", "list", "--limit", "100")) ?? []).filter((a) => String(a.startTimeGMT ?? "") >= start);
  const workouts = mapActivities(activities);
  if (workouts.length) await push(state, { batchId: crypto.randomUUID(), sentAt: new Date().toISOString(), source, workouts }, "activities");

  await saveState({ ...state, cursor: today, lastRunAt: new Date().toISOString() });
  console.log(`Done. Cursor at ${today}.`);
}

async function main() {
  const [command, arg] = positionals;
  if (command === "pair") return pair(arg);

  const state = await loadState();
  if (command === "status") {
    console.log(state ? { server: state.server, deviceId: state.deviceId, cursor: state.cursor ?? "never synced", lastRunAt: state.lastRunAt } : "Not paired — run `pnpm pair:code`, then `pnpm gccli:pair <CODE>`");
    console.log(`gccli: ${await gccliAuthStatus()}`);
    return;
  }
  if (command !== "sync") throw new Error("Commands: pair <CODE> | sync [--since YYYY-MM-DD | --days N] [--watch --every MIN] | status");
  if (!state) throw new Error("Not paired — run `pnpm pair:code`, then `pnpm gccli:pair <CODE>`");

  await sync(state);
  if (!values.watch) return;
  const minutes = Math.max(1, Number(values.every));
  console.log(`Watching: next sync every ${minutes} min (Ctrl+C to stop)`);
  for (;;) {
    await new Promise((r) => setTimeout(r, minutes * 60_000));
    await sync((await loadState())!).catch((error) => console.error(`Sync failed: ${(error as Error).message}`));
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
