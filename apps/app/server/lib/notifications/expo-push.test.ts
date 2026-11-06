import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";

const sent: { to: string; data?: { url: string } }[] = [];
vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken = (t: string) => t.startsWith("ExponentPushToken[");
    chunkPushNotifications = (messages: unknown[]) => [messages];
    sendPushNotificationsAsync = async (messages: { to: string; data?: { url: string } }[]) => {
      sent.push(...messages);
      return messages.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }));
    };
  },
}));

const { createExpoPushChannel } = await import("./expo-push");
const { addExpoToken, addSubscription, listEntries } = await import("./web-push");

const user = "ola@example.com";

describe("expo push channel", () => {
  beforeAll(setupTestDb);

  it("delivers to expo tokens with the thread url and prunes dead tokens only", async () => {
    await addSubscription(user, { endpoint: "https://push.example/browser", keys: { p256dh: "p", auth: "a" } });
    await addExpoToken(user, "ExponentPushToken[live]");
    await addExpoToken(user, "ExponentPushToken[dead]");
    const channel = createExpoPushChannel();
    expect(await channel.deliver({ severity: "info", title: "Data arrived", metadata: { url: "/dashboard/x" } }, { owner: user })).toBe(true);
    expect(sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[dead]", "ExponentPushToken[live]"]);
    expect(sent[0]?.data).toEqual({ url: "/dashboard/x" });
    const entries = await listEntries(user);
    expect(entries.map((e) => (e.kind === "expo" ? e.token : (e as { endpoint: string }).endpoint)).sort()).toEqual([
      "ExponentPushToken[live]",
      "https://push.example/browser",
    ]);
  });

  it("reports nothing delivered without expo tokens", async () => {
    expect(await createExpoPushChannel().deliver({ severity: "info", title: "x" }, { owner: "nobody@example.com" })).toBe(false);
  });
});
