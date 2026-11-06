import type { AddressInfo } from "node:net";

import { HttpException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import express from "express";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { createApp } from "../app.factory";
import { DbService } from "../common/db/db.service";
import { chatThreads } from "../db/schema";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatThreadStore } from "./chat-thread.store";

const model = vi.hoisted(() => ({ coachModel: vi.fn() }));
vi.mock("./model", () => model);

const dbs = new DbService();
const threads = new ChatThreadStore(dbs);
const owner = `chat-${Date.now()}@t.co`;
const coach = { getProfile: async () => ({ profile: { timezone: "Not/AZone" }, onboarded: true, readoutScheduled: false }) };
const svc = new ChatService(threads, dbs, coach as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
async function mockModel(chunks: unknown[]) {
  const { MockLanguageModelV2, simulateReadableStream } = await import("ai/test");
  return new MockLanguageModelV2({ doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks as never[] }) }) });
}
const textTurn = (text: string) => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: "stop", usage },
];

async function post(body: unknown) {
  const app = express().use(express.json());
  app.post("/api/chat", (req, res) => new ChatController(svc, threads).stream(owner, req.body, res).catch((e: HttpException) => res.status(e.getStatus?.() ?? 500).json(e.getResponse?.() ?? {})));
  const server = app.listen(0);
  try {
    return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } finally {
    setTimeout(() => server.close(), 50);
  }
}

beforeEach(() => dbs.db.delete(chatThreads).where(eq(chatThreads.ownerEmail, owner)));
afterAll(async () => {
  await dbs.db.delete(chatThreads).where(eq(chatThreads.ownerEmail, owner));
  await dbs.onModuleDestroy();
});

test("streams assistant text and persists the full thread on finish", async () => {
  model.coachModel.mockResolvedValue(await mockModel(textTurn("Hello coach")));
  const m = await mockModel(textTurn("Hello coach"));
  model.coachModel.mockResolvedValue(m);
  const res = await post({ dashboardId: "d1", messages: [user("u1", "hi")] });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Hello coach");
  expect(m.doStreamCalls[0]!.abortSignal).toBeInstanceOf(AbortSignal); // disconnect stops model + tools
  await vi.waitFor(async () => {
    const t = await threads.load(owner, "d1");
    expect(t.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(t[1])).toContain("Hello coach");
  });
});

test("a tool call is persisted as a tool part", async () => {
  model.coachModel.mockResolvedValue(
    await mockModel([
      { type: "tool-call", toolCallId: "c1", toolName: "show-widget", input: JSON.stringify({ widget: { kind: "metric", metric: "steps", range: "7d" } }) },
      { type: "finish", finishReason: "tool-calls", usage },
    ]),
  );
  const res = await post({ dashboardId: "d2", messages: [user("u1", "chart steps")] });
  await res.text();
  await vi.waitFor(async () => {
    const t = await threads.load(owner, "d2");
    expect(t.at(-1)!.parts.some((p) => p.type === "tool-show-widget")).toBe(true);
  });
});

test("no model → 503 coach_unavailable and the thread is unchanged", async () => {
  await threads.save(owner, "d3", [user("u0", "before")]);
  model.coachModel.mockRejectedValue(new Error("no key"));
  const res = await post({ dashboardId: "d3", messages: [user("u1", "hi")] });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "Coach is unavailable", errorCode: "coach_unavailable" });
  expect(await threads.load(owner, "d3")).toEqual([user("u0", "before")]);
});

test("rejects a missing dashboardId", async () => {
  expect((await post({ messages: [] })).status).toBe(400);
});

test("POST /api/chat without a session → 401 through the real AuthGuard", async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  model.coachModel.mockClear();
  const app = await createApp();
  try {
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dashboardId: "d1", messages: [] }) });
    expect(res.status).toBe(401);
    expect(model.coachModel).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("owner isolation: another owner's turn on the same dashboardId sees no prior thread and leaves it untouched", async () => {
  const other = `other-${owner}`;
  const secret = [user("a1", "ownerA-secret-message")];
  await threads.save(owner, "dx", secret);
  const m = await mockModel(textTurn("hi B"));
  model.coachModel.mockResolvedValue(m);
  try {
    await (await svc.stream(other, { dashboardId: "dx", messages: [user("b1", "hello")] })).text();
    expect(JSON.stringify(m.doStreamCalls[0]!.prompt)).not.toContain("ownerA-secret-message");
    await vi.waitFor(async () => expect((await threads.load(other, "dx")).map((x) => x.id)).toEqual(["b1", expect.any(String)]));
    expect(await threads.load(owner, "dx")).toEqual(secret);
  } finally {
    await dbs.db.delete(chatThreads).where(eq(chatThreads.ownerEmail, other));
  }
});
