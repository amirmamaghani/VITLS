/** Expo push-token store (one row per owner+token). */
import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { expoPushTokens } from "../db/schema";

@Injectable()
export class PushService {
  constructor(private readonly dbs: DbService) {}

  /** Accepts only Expo[nent]PushToken[...] with a non-empty body; rejects bare UUIDs and empty []. */
  isExpoPushToken(token: string): boolean {
    return typeof token === "string" && /^Expo(nent)?PushToken\[.+\]$/.test(token);
  }

  async addExpoToken(ownerEmail: string, token: string, label?: string, deviceId?: string): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.dbs.db
      .insert(expoPushTokens)
      .values({ id: randomUUID(), ownerEmail, token, label, deviceId, createdAt })
      .onConflictDoUpdate({
        target: [expoPushTokens.ownerEmail, expoPushTokens.token],
        // Re-registering without a deviceId keeps the existing binding rather than nulling it.
        set: { label: label ?? null, deviceId: deviceId ?? sql`${expoPushTokens.deviceId}`, createdAt },
      });
  }

  async removeExpoToken(ownerEmail: string, token: string): Promise<void> {
    await this.dbs.db
      .delete(expoPushTokens)
      .where(and(eq(expoPushTokens.ownerEmail, ownerEmail), eq(expoPushTokens.token, token)));
  }

  async removeExpoTokensForDevice(ownerEmail: string, deviceId: string): Promise<void> {
    await this.dbs.db
      .delete(expoPushTokens)
      .where(and(eq(expoPushTokens.ownerEmail, ownerEmail), eq(expoPushTokens.deviceId, deviceId)));
  }

  /** Overridable in tests so no network is needed. */
  protected async expoClient() {
    const { Expo } = await import("expo-server-sdk");
    return new Expo();
  }

  /** Push to every Expo token of the owner; prunes tokens Expo reports as DeviceNotRegistered. */
  async send(
    ownerEmail: string,
    { title, body, data }: { title: string; body?: string; data?: Record<string, unknown> },
  ): Promise<{ sent: number }> {
    const rows = await this.dbs.db.select({ token: expoPushTokens.token }).from(expoPushTokens).where(eq(expoPushTokens.ownerEmail, ownerEmail));
    if (rows.length === 0) return { sent: 0 };
    const messages = rows.map((r) => ({
      to: r.token,
      title,
      body: body ?? "",
      data: { url: data?.url ?? "/home", ...data },
      sound: "default" as const,
    }));
    const expo = await this.expoClient();
    for (const chunk of expo.chunkPushNotifications(messages)) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      await Promise.all(
        tickets.map((t, i) =>
          t.status !== "ok" && t.details?.error === "DeviceNotRegistered" ? this.removeExpoToken(ownerEmail, chunk[i]!.to as string) : undefined,
        ),
      );
    }
    return { sent: messages.length };
  }
}
