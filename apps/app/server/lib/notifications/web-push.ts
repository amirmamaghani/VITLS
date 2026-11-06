/**
 * Web Push for the PWA (docs/design/03-coach.md §9): subscriptions live in the native user setting `vitls-push`;
 * one notification channel delivers every `notify()` / `manage-notifications send` to the user's devices.
 */
import type { NotificationChannel } from "@agent-native/core/notifications";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import webpush, { type PushSubscription } from "web-push";
import { z } from "zod";

const SETTING_KEY = "vitls-push";
const MAX_SUBSCRIPTIONS = 10;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export type StoredEntry =
  | ({ kind?: "webpush"; label?: string; createdAt: string } & PushSubscription)
  | { kind: "expo"; token: string; label?: string; /** The paired device that registered it; revoking the device drops the token. */ deviceId?: string; createdAt: string };

const isExpo = (e: StoredEntry): e is Extract<StoredEntry, { kind: "expo" }> => e.kind === "expo";

/** VAPID config from deploy-level env; push is disabled when it is absent. */
export function vapidConfig() {
  // guard:allow-env-credential — deploy-level VAPID key pair for Web Push (server identity, not a user credential)
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  // guard:allow-env-credential — deploy-level VAPID key pair for Web Push (server identity, not a user credential)
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  // guard:allow-env-credential — VAPID contact (mailto:/https:), deployment setting
  const subject = process.env.VAPID_SUBJECT ?? "mailto:coach@vitls.ai";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : undefined;
}

export async function listEntries(userEmail: string): Promise<StoredEntry[]> {
  const value = await getUserSetting(userEmail, SETTING_KEY);
  return Array.isArray(value?.subscriptions) ? (value.subscriptions as StoredEntry[]) : [];
}

async function replaceEntries(userEmail: string, update: (entries: StoredEntry[]) => StoredEntry[]) {
  await mutateUserSetting(userEmail, SETTING_KEY, (current) => ({
    subscriptions: update(Array.isArray(current?.subscriptions) ? (current.subscriptions as StoredEntry[]) : []).slice(-MAX_SUBSCRIPTIONS),
  }));
}

export async function addSubscription(userEmail: string, subscription: PushSubscription, label?: string) {
  await replaceEntries(userEmail, (entries) => [
    ...entries.filter((e) => isExpo(e) || e.endpoint !== subscription.endpoint),
    { ...subscription, label, createdAt: new Date().toISOString() },
  ]);
}

export async function removeSubscription(userEmail: string, endpoint: string) {
  await replaceEntries(userEmail, (entries) => entries.filter((e) => isExpo(e) || e.endpoint !== endpoint));
}

export async function addExpoToken(userEmail: string, token: string, label?: string, deviceId?: string) {
  await replaceEntries(userEmail, (entries) => [
    ...entries.filter((e) => !isExpo(e) || e.token !== token),
    { kind: "expo", token, label, deviceId, createdAt: new Date().toISOString() },
  ]);
}

export async function removeExpoToken(userEmail: string, token: string) {
  await replaceEntries(userEmail, (entries) => entries.filter((e) => !isExpo(e) || e.token !== token));
}

/** Drops every Expo token a revoked device registered (the revoked device can no longer call DELETE itself). */
export async function removeExpoTokensForDevice(userEmail: string, deviceId: string) {
  await replaceEntries(userEmail, (entries) => entries.filter((e) => !isExpo(e) || e.deviceId !== deviceId));
}

/** Notification channel: sends to every stored subscription; prunes subscriptions the push service rejects as gone. */
export function createWebPushChannel(config: NonNullable<ReturnType<typeof vapidConfig>>): NotificationChannel {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    name: "webpush",
    async deliver(input, meta) {
      const subscriptions = (await listEntries(meta.owner)).filter((e): e is Exclude<StoredEntry, { kind: "expo" }> => !isExpo(e));
      if (subscriptions.length === 0) return false;
      const payload = JSON.stringify({ title: input.title, body: input.body ?? "", url: "/home" });
      const results = await Promise.allSettled(subscriptions.map((s) => webpush.sendNotification(s, payload, { TTL: 12 * 3600 })));
      await Promise.all(
        results.map((r, i) => {
          const status = r.status === "rejected" ? (r.reason as { statusCode?: number }).statusCode : undefined;
          return status === 404 || status === 410 ? removeSubscription(meta.owner, subscriptions[i]!.endpoint) : undefined;
        }),
      );
      return results.some((r) => r.status === "fulfilled");
    },
  };
}
