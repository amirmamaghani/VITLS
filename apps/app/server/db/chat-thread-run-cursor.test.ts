import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../test/db";
import { getDb } from ".";

const thread = (runs: object[], events: object[]) => JSON.stringify({ messages: [], agentKit: { runs, events } });
const cursors = async (id: string) => {
  const { rows } = (await getDb().execute(sql`SELECT thread_data FROM chat_threads WHERE id = ${id}`)) as { rows: { thread_data: string }[] };
  return (JSON.parse(rows[0]!.thread_data).agentKit.runs as { id: string; lastSequence: number }[]).map((r) => r.lastSequence);
};

describe("chat_threads run cursor trigger (agent-native#7377)", () => {
  beforeAll(async () => {
    await setupTestDb();
    // The framework owns this table; the migration defers until it exists, then applies on the next run.
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, thread_data TEXT NOT NULL DEFAULT '{}', updated_at BIGINT NOT NULL DEFAULT 0)`);
    await setupTestDb();
  });

  it("sets each run cursor to its highest persisted event sequence, 0 without events", async () => {
    const data = thread(
      [{ id: "run-a", lastSequence: 192 }, { id: "run-b", lastSequence: 62 }],
      [{ runId: "run-b", sequence: 9, type: "run.completed" }],
    );
    await getDb().execute(sql`INSERT INTO chat_threads (id, thread_data) VALUES ('t1', ${data})`);
    expect(await cursors("t1")).toEqual([0, 9]);
    await getDb().execute(sql`UPDATE chat_threads SET thread_data = ${thread([{ id: "run-a", lastSequence: 200 }], [])} WHERE id = 't1'`);
    expect(await cursors("t1")).toEqual([0]);
  });

  it("drops the _mergeRootMessages flag", async () => {
    const data = JSON.stringify({ messages: [], agentKit: { _mergeRootMessages: true, runs: [], events: [] } });
    await getDb().execute(sql`INSERT INTO chat_threads (id, thread_data) VALUES ('t3', ${data})`);
    const { rows } = (await getDb().execute(sql`SELECT thread_data FROM chat_threads WHERE id = 't3'`)) as { rows: { thread_data: string }[] };
    expect(JSON.parse(rows[0]!.thread_data).agentKit).toEqual({ runs: [], events: [] });
  });

  it("leaves rows without a snapshot untouched", async () => {
    await getDb().execute(sql`INSERT INTO chat_threads (id, thread_data) VALUES ('t2', '{"messages":[]}')`);
    const { rows } = (await getDb().execute(sql`SELECT thread_data FROM chat_threads WHERE id = 't2'`)) as { rows: { thread_data: string }[] };
    expect(rows[0]!.thread_data).toBe('{"messages":[]}');
  });
});
