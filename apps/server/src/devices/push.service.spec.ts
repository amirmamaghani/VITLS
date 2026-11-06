import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { expoPushTokens } from "../db/schema";
import { PushService } from "./push.service";

describe("PushService", () => {
  const dbs = new DbService();
  const svc = new PushService(dbs);
  const owner = `push-${Date.now()}@t.co`;
  const rows = (token?: string) =>
    dbs.db.select().from(expoPushTokens).where(
      token ? and(eq(expoPushTokens.ownerEmail, owner), eq(expoPushTokens.token, token)) : eq(expoPushTokens.ownerEmail, owner),
    );

  const sendOwner = `send-${Date.now()}@t.co`;
  const emptyOwner = `empty-${Date.now()}@t.co`;
  const stub = (tickets: unknown[]) => {
    const sent: any[][] = [];
    const client = {
      chunkPushNotifications: (m: any[]) => [m],
      sendPushNotificationsAsync: async (chunk: any[]) => (sent.push(chunk), tickets),
    };
    class Stubbed extends PushService {
      protected override async expoClient() {
        return client as any;
      }
    }
    return { svc: new Stubbed(dbs), sent };
  };

  afterAll(async () => {
    await dbs.db.delete(expoPushTokens).where(inArray(expoPushTokens.ownerEmail, [owner, sendOwner, emptyOwner]));
    await dbs.onModuleDestroy();
  });

  test("add round-trips and upserts on (owner, token)", async () => {
    await svc.addExpoToken(owner, "ExponentPushToken[a]", "one", "d1");
    await svc.addExpoToken(owner, "ExponentPushToken[a]", "two", "d2");
    const r = await rows("ExponentPushToken[a]");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ label: "two", deviceId: "d2" });
  });

  test("removeExpoToken deletes it", async () => {
    await svc.addExpoToken(owner, "ExponentPushToken[b]");
    await svc.removeExpoToken(owner, "ExponentPushToken[b]");
    expect(await rows("ExponentPushToken[b]")).toHaveLength(0);
  });

  test("removeExpoTokensForDevice leaves other devices' tokens", async () => {
    await svc.addExpoToken(owner, "ExponentPushToken[c1]", undefined, "dx");
    await svc.addExpoToken(owner, "ExponentPushToken[c2]", undefined, "dx");
    await svc.addExpoToken(owner, "ExponentPushToken[c3]", undefined, "dy");
    await svc.removeExpoTokensForDevice(owner, "dx");
    expect((await rows()).map((r) => r.deviceId)).not.toContain("dx");
    expect(await rows("ExponentPushToken[c3]")).toHaveLength(1);
  });

  test("re-registering without a deviceId keeps the existing binding", async () => {
    await svc.addExpoToken(owner, "ExponentPushToken[keep]", "first", "dkeep");
    await svc.addExpoToken(owner, "ExponentPushToken[keep]", "relabel");
    const r = await rows("ExponentPushToken[keep]");
    expect(r[0]).toMatchObject({ label: "relabel", deviceId: "dkeep" });
  });

  test("isExpoPushToken accepts valid and rejects junk", () => {
    expect(svc.isExpoPushToken("ExponentPushToken[xxxxxxxx]")).toBe(true);
    expect(svc.isExpoPushToken("ExpoPushToken[xxxxxxxx]")).toBe(true);
    expect(svc.isExpoPushToken("nope")).toBe(false);
    expect(svc.isExpoPushToken("ExponentPushToken[unterminated")).toBe(false);
    expect(svc.isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(svc.isExpoPushToken("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
  });

  describe("send", () => {
    const [t1, t2] = ["ExponentPushToken[s1]", "ExponentPushToken[s2]"];
    beforeEach(async () => {
      await dbs.db.delete(expoPushTokens).where(eq(expoPushTokens.ownerEmail, sendOwner));
      await svc.addExpoToken(sendOwner, t1);
      await svc.addExpoToken(sendOwner, t2);
    });

    test("builds one message per token and returns sent count", async () => {
      const { svc: s, sent } = stub([{ status: "ok" }, { status: "ok" }]);
      expect(await s.send(sendOwner, { title: "T", body: "B" })).toEqual({ sent: 2 });
      expect(sent[0]).toHaveLength(2);
      expect(sent[0]![0]).toMatchObject({ title: "T", body: "B", data: { url: "/home" }, sound: "default" });
      expect(sent[0]!.map((m) => m.to).sort()).toEqual([t1, t2]);
    });

    test("prunes a DeviceNotRegistered token", async () => {
      const { svc: s, sent } = stub([{ status: "ok" }, { status: "ok" }]);
      await s.send(sendOwner, { title: "T" }); // learn chunk order
      const dead = sent[0]![1].to as string;
      const { svc: s2 } = stub([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }]);
      await s2.send(sendOwner, { title: "T" });
      const left = (await dbs.db.select().from(expoPushTokens).where(eq(expoPushTokens.ownerEmail, sendOwner))).map((r) => r.token);
      expect(left).toHaveLength(1);
      expect(left).not.toContain(dead);
    });

    test("no tokens -> sent 0, no send", async () => {
      const { svc: s, sent } = stub([]);
      expect(await s.send(emptyOwner, { title: "T" })).toEqual({ sent: 0 });
      expect(sent).toHaveLength(0);
    });
  });
});
