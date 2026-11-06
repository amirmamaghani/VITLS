import { eq } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { chatThreads } from "../db/schema";
import { ChatThreadStore } from "./chat-thread.store";

type UIMessage = import("ai", { with: { "resolution-mode": "import" } }).UIMessage;

describe("ChatThreadStore", () => {
  const dbs = new DbService();
  const store = new ChatThreadStore(dbs);
  const run = Date.now();
  const a = `ct-a-${run}@t.co`;
  const b = `ct-b-${run}@t.co`;
  const msgs: UIMessage[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: "how is my sleep?" }] },
    {
      id: "2",
      role: "assistant",
      parts: [
        { type: "tool-getMetric", toolCallId: "c1", state: "output-available", input: { metric: "sleep" }, output: { avg: 7.2 } },
        { type: "text", text: "7.2h average" },
      ],
    } as UIMessage,
  ];

  afterAll(async () => {
    for (const o of [a, b]) await dbs.db.delete(chatThreads).where(eq(chatThreads.ownerEmail, o));
    await dbs.onModuleDestroy();
  });

  test("round-trips tool parts, owner-scoped, replace not append, list", async () => {
    expect(await store.load(a, "d1")).toEqual([]);
    await store.save(a, "d1", msgs, "Sleep");
    expect(await store.load(a, "d1")).toEqual(msgs);
    expect(await store.load(b, "d1")).toEqual([]);

    await store.save(a, "d1", msgs.slice(0, 1));
    expect(await store.load(a, "d1")).toEqual(msgs.slice(0, 1));

    const list = await store.list(a);
    expect(list).toEqual([{ dashboardId: "d1", title: "Sleep", updatedAt: expect.any(String) }]);
    expect(await store.list(b)).toEqual([]);
  });
});
