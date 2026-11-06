import { eq } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { coachMemories } from "../db/schema";
import { MemoriesService } from "./memories.service";

describe("MemoriesService", () => {
  const dbs = new DbService();
  const svc = new MemoriesService(dbs);
  const run = Date.now();
  const a = `mem-a-${run}@t.co`;
  const empty = `mem-empty-${run}@t.co`;

  beforeAll(async () => {
    await svc.save(a, { name: "knee-injury", type: "user", description: "left knee ACL, avoid deep squats", content: "ACL 2024" });
    await svc.save(a, { name: "prefers-mornings", type: "feedback", description: "trains before work", content: "6am" });
  });

  afterAll(async () => {
    await dbs.db.delete(coachMemories).where(eq(coachMemories.ownerEmail, a));
    await dbs.db.delete(coachMemories).where(eq(coachMemories.ownerEmail, "mem-stop@t.co"));
    await dbs.onModuleDestroy();
  });

  test("save upserts and list returns all", async () => {
    await svc.save(a, { name: "prefers-mornings", type: "feedback", description: "trains before work", content: "5:30am" });
    const l = await svc.list(a);
    expect(l.map((m) => m.name).sort()).toEqual(["knee-injury", "prefers-mornings"]);
    expect(l.find((m) => m.name === "prefers-mornings")?.content).toBe("5:30am");
  });

  test("selectRelevant ranks by token overlap", async () => {
    const r = await svc.selectRelevant(a, "my knee hurts during squats", 1);
    expect(r.map((m) => m.name)).toEqual(["knee-injury"]);
  });

  test("diacritics ignored", async () => {
    expect((await svc.selectRelevant(a, "KNÉE", 2)).map((m) => m.name)).toEqual(["knee-injury"]);
  });

  test("empty query, empty store, no match -> []", async () => {
    expect(await svc.selectRelevant(a, "  ", 2)).toEqual([]);
    expect(await svc.selectRelevant(empty, "knee", 2)).toEqual([]);
    expect(await svc.selectRelevant(a, "zebra", 2)).toEqual([]);
  });

  test("stopwords and short tokens do not match inside longer words", async () => {
    const o = "mem-stop@t.co";
    await svc.save(o, { name: "plan", type: "user", description: "strength training twice weekly", content: "x" });
    expect((await svc.selectRelevant(o, "how is my training going in a week", 2)).map((m) => m.name)).toEqual(["plan"]);
    expect(await svc.selectRelevant(o, "how am I doing in a month", 2)).toEqual([]);
    expect(await svc.selectRelevant(o, "in", 2)).toEqual([]);
  });

  test("a short word stored in a memory does not prefix-match longer query tokens", async () => {
    const o = "mem-stop@t.co";
    await svc.save(o, { name: "knee", type: "user", description: "knee pain in deep squats", content: "x" });
    expect(await svc.selectRelevant(o, "injury history", 2)).toEqual([]);
    expect((await svc.selectRelevant(o, "deep squats", 2)).map((m) => m.name)).toEqual(["knee"]);
  });
});
