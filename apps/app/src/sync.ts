/**
 * Pairing, sync and disconnect against the VITLS ingest contract (docs/design/02-data-model-and-ingest.md).
 * The device token lives only in SecureStore; the server never sees raw health-store credentials.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import type { IngestBatchInput } from "@vitls/health-ingest";

import { provider, read, requestAccess } from "./health";
import { ensurePushToken } from "./push";
import { loadSession } from "./server-client"; // session bearer for the authenticated self-pair

export interface State {
  server: string;
  token: string;
  deviceId: string;
  /** End of the last window pushed with 2xx; the next sync restarts one day earlier to catch late data. */
  cursor?: string;
  lastSyncAt?: string;
  lastError?: string;
  expoToken?: string;
}

const KEY = "vitls";
/** Set by disconnect (also after a server-side revoke): the still-signed-in WebView must not silently pair again. */
const DISCONNECTED_KEY = "vitls-disconnected";
const TASK = "vitls-sync";
const DAY_MS = 86_400_000;
const FIRST_SYNC_DAYS = 14;

export const loadState = async (): Promise<State | undefined> => {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as State) : undefined;
};
export const saveState = (state: State) => SecureStore.setItemAsync(KEY, JSON.stringify(state));

export const isDisconnected = async () => (await SecureStore.getItemAsync(DISCONNECTED_KEY)) === "1";
/** Cleared only by an explicit user action: "Send sign-in link" on the login screen or a pairing code on the pair screen. */
export const clearDisconnected = () => SecureStore.deleteItemAsync(DISCONNECTED_KEY);

/** The device token travels with every request: HTTPS only, except plain HTTP in development builds. */
function safeOrigin(server: string): string {
  const url = new URL(server.trim());
  if (url.protocol !== "https:" && !__DEV__) throw new Error("Server URL must use https://");
  return url.origin;
}

export async function request<T>(state: Pick<State, "server" | "token">, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${state.server}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${state.token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json as T;
}

export async function pair(server: string, code: string): Promise<State> {
  const origin = safeOrigin(server);
  const device = { platform: Platform.OS, model: Device.modelName ?? undefined, appVersion: Constants.expoConfig?.version };
  const res = await fetch(`${origin}/api/devices/redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, device }) });
  const json = (await res.json().catch(() => ({}))) as { token: string; deviceId: string; error?: string };
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  const { token, deviceId } = json;
  const state = { server: origin, token, deviceId };
  await saveState(state);
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  return ensurePushToken(state).catch(() => state);
}

/** Pairs THIS phone over the signed-in session — no code to type (the signed-in phone pairs itself).
    Issues a write-only device token; actual health data only flows once the OS health permission is granted. */
export async function selfPair(server: string): Promise<State> {
  const origin = safeOrigin(server);
  const session = await loadSession();
  if (!session) throw new Error("unauthorized");
  const device = { platform: Platform.OS, model: Device.modelName ?? undefined, appVersion: Constants.expoConfig?.version };
  const res = await fetch(`${origin}/api/devices/pair`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session}` }, body: JSON.stringify({ device }) });
  const json = (await res.json().catch(() => ({}))) as { token: string; deviceId: string; error?: string };
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  const state = { server: origin, token: json.token, deviceId: json.deviceId };
  await SecureStore.deleteItemAsync(DISCONNECTED_KEY); // an explicit pair re-enables sync
  await saveState(state);
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 }).catch(() => {});
  return ensurePushToken(state).catch(() => state);
}

/** Runs while the app is closed: WorkManager on Android (≥15 min), BGTaskScheduler on iOS (at the system's discretion). */
TaskManager.defineTask(TASK, async () => {
  const state = await loadState();
  if (!state) return BackgroundTask.BackgroundTaskResult.Success;
  const next = await syncOrDisconnect(state);
  if (!next) return BackgroundTask.BackgroundTaskResult.Success; // revoked: stop retrying a dead token
  return next.lastError ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

export async function sync(state: State): Promise<State> {
  const now = new Date();
  const since = new Date(state.cursor ? Date.parse(state.cursor) - DAY_MS : now.getTime() - FIRST_SYNC_DAYS * DAY_MS);
  try {
    if (!(await requestAccess())) throw new Error("Health data access was not granted");
    const batch: IngestBatchInput = {
      batchId: uuid(),
      sentAt: now.toISOString(),
      source: { provider, via: "companion", app: "VITLS Companion", device: Device.modelName ?? undefined, os: `${Platform.OS} ${Device.osVersion ?? ""}`.trim() },
      ...(await read(since, now)),
    };
    await request(state, "POST", "/api/ingest/v1/batches", batch);
    return await persist({ ...state, cursor: now.toISOString(), lastSyncAt: now.toISOString(), lastError: undefined });
  } catch (error) {
    return persist({ ...state, lastError: (error as Error).message });
  }
}

/** RFC 4122 v4 from Math.random: Hermes has no global crypto; the id only de-duplicates retries. */
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.random() * 16 : (Math.random() * 4) | 8) | 0).toString(16));

const persist = async (state: State) => (await saveState(state), state);

export async function disconnect() {
  const s = await loadState();
  if (s?.expoToken) await request(s, "DELETE", "/api/devices/push", { expoToken: s.expoToken }).catch(() => {});
  await Promise.all([SecureStore.setItemAsync(DISCONNECTED_KEY, "1"), SecureStore.deleteItemAsync(KEY), BackgroundTask.unregisterTaskAsync(TASK).catch(() => {})]);
}

/** Sync, and when the server has revoked this device drop all local state; null means "no longer connected". */
export async function syncOrDisconnect(state: State): Promise<State | null> {
  const next = await sync(state);
  if (next.lastError !== "unauthorized") return next;
  await disconnect();
  return null;
}
