/** Session-authed client for reads and chat. Uses the BetterAuth SESSION token (key "vitls-session"), never the write-only device token. */
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";

import { sameOrigin } from "./bridge";

export const SERVER = process.env.EXPO_PUBLIC_VITLS_SERVER ?? "";
const KEY = "vitls-session";

const base = () => {
  if (!SERVER) throw new Error("EXPO_PUBLIC_VITLS_SERVER is not set");
  return SERVER;
};

export class Unauthorized extends Error {
  constructor() {
    super("unauthorized");
  }
}

export const saveSession = (token: string) => SecureStore.setItemAsync(KEY, token);
export const loadSession = () => SecureStore.getItemAsync(KEY);
export const clearSession = () => SecureStore.deleteItemAsync(KEY);

const LAST_CHAT = "vitls-last-chat";
export const saveLastChat = (dashboardId: string) => SecureStore.setItemAsync(LAST_CHAT, dashboardId);
export const loadLastChat = () => SecureStore.getItemAsync(LAST_CHAT);

async function headers() {
  const token = await loadSession();
  if (!token) throw new Unauthorized();
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function fail(res: Response): Promise<never> {
  if (res.status === 401) {
    await clearSession();
    throw new Unauthorized();
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string; errorCode?: string };
  throw new Error(j.error ?? j.errorCode ?? `HTTP ${res.status}`);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, { method, headers: await headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  return call<T>("GET", path + qs);
}

export const apiPost = <T>(path: string, body?: unknown) => call<T>("POST", path, body);

/** Streaming POST /api/chat for the AI SDK transport; the caller parses the body. */
export async function chatStream(body: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<Response> {
  const res = await expoFetch(`${base()}/api/chat`, { method: "POST", headers: await headers(), body: JSON.stringify(body), signal });
  if (!res.ok) return fail(res as unknown as Response);
  return res as unknown as Response;
}

/**
 * Completes a magic-link verify: BetterAuth's bearer plugin puts the session token in `set-auth-token` on the response that sets the
 * session cookie (the 302 included, hence redirect: "manual"). Only our own origin is ever contacted. Returns false if no token came back.
 */
export function captureSession(verifyUrl: string): Promise<boolean> {
  // One verify per link: the token is one-time and React StrictMode runs effects twice in dev.
  let p = inflight.get(verifyUrl);
  if (!p) inflight.set(verifyUrl, (p = verify(verifyUrl)));
  return p;
}

const inflight = new Map<string, Promise<boolean>>();

async function verify(verifyUrl: string): Promise<boolean> {
  if (!sameOrigin(verifyUrl, base())) return false;
  const res = await expoFetch(verifyUrl, { redirect: "manual" });
  const token = res.headers.get("set-auth-token");
  if (!token) return false;
  await saveSession(token);
  return true;
}
