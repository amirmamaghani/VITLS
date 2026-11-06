/** Native push for the companion app: one NotificationChannel over Expo's push service, tokens from the vitls-push setting. */
import type { NotificationChannel } from "@agent-native/core/notifications";
import { Expo } from "expo-server-sdk";

import { listEntries, removeExpoToken } from "./web-push";

export const isExpoPushToken = (token: string) => Expo.isExpoPushToken(token);

export function createExpoPushChannel(): NotificationChannel {
  const expo = new Expo();
  return {
    name: "expo",
    async deliver(input, meta) {
      const tokens = (await listEntries(meta.owner)).flatMap((e) => (e.kind === "expo" ? [e.token] : []));
      if (tokens.length === 0) return false;
      const url = typeof input.metadata?.url === "string" ? input.metadata.url : "/home";
      const messages = tokens.map((to) => ({ to, title: input.title, body: input.body ?? "", data: { url }, sound: "default" as const }));
      let delivered = false;
      for (const chunk of expo.chunkPushNotifications(messages)) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        await Promise.all(
          tickets.map((ticket, i) => {
            if (ticket.status === "ok") return (delivered = true);
            return ticket.details?.error === "DeviceNotRegistered" ? removeExpoToken(meta.owner, chunk[i]!.to as string) : undefined;
          }),
        );
      }
      return delivered;
    },
  };
}
