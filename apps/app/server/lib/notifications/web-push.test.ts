import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";

const sent: string[] = [];
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push(sub.endpoint);
    },
  },
}));

const { addSubscription, createWebPushChannel } = await import("./web-push");
const { getUserSetting } = await import("@agent-native/core/settings");

const user = "ivo@example.com";
const keys = { p256dh: "p", auth: "a" };

describe("web push channel", () => {
  beforeAll(setupTestDb);

  it("delivers to every device and prunes subscriptions the push service rejects", async () => {
    await addSubscription(user, { endpoint: "https://push.example/phone", keys });
    await addSubscription(user, { endpoint: "https://push.example/gone", keys });
    const channel = createWebPushChannel({ publicKey: "pk", privateKey: "sk", subject: "mailto:x@y.z" });

    expect(await channel.deliver({ severity: "info", title: "Good morning" }, { owner: user })).toBe(true);
    expect(sent).toEqual(["https://push.example/phone"]);
    const stored = (await getUserSetting(user, "vitls-push"))?.subscriptions as { endpoint: string }[];
    expect(stored.map((s) => s.endpoint)).toEqual(["https://push.example/phone"]);
  });

  it("reports nothing delivered for users without subscriptions", async () => {
    const channel = createWebPushChannel({ publicKey: "pk", privateKey: "sk", subject: "mailto:x@y.z" });
    expect(await channel.deliver({ severity: "info", title: "x" }, { owner: "nobody@example.com" })).toBe(false);
  });

  it("replaces a re-registered endpoint instead of duplicating it", async () => {
    await addSubscription(user, { endpoint: "https://push.example/phone", keys }, "iPhone");
    const stored = (await getUserSetting(user, "vitls-push"))?.subscriptions as { endpoint: string; label?: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.label).toBe("iPhone");
  });

  it("stores expo tokens beside web push subscriptions and keeps them apart", async () => {
    const { addExpoToken, removeExpoToken, listEntries } = await import("./web-push");
    await addExpoToken(user, "ExponentPushToken[abc]", "Pixel 8");
    await addExpoToken(user, "ExponentPushToken[abc]", "Pixel 8 again");
    const entries = await listEntries(user);
    expect(entries.filter((e) => e.kind === "expo")).toHaveLength(1);
    expect(entries.some((e) => !e.kind && (e as { endpoint: string }).endpoint === "https://push.example/phone")).toBe(true);

    const channel = createWebPushChannel({ publicKey: "pk", privateKey: "sk", subject: "mailto:x@y.z" });
    sent.length = 0;
    await channel.deliver({ severity: "info", title: "x" }, { owner: user });
    expect(sent).toEqual(["https://push.example/phone"]); // the expo token is not a web push endpoint

    await removeExpoToken(user, "ExponentPushToken[abc]");
    expect((await listEntries(user)).filter((e) => e.kind === "expo")).toHaveLength(0);
    expect((await listEntries(user)).length).toBe(1);
  });
});
