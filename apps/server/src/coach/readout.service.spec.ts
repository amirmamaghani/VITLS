import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import { userSettings } from "../db/schema";
import { CoachService } from "./coach.service";
import { ReadoutService } from "./readout.service";

const model = vi.hoisted(() => ({ coachModel: vi.fn(), hasCoachKey: vi.fn(() => true) }));
vi.mock("./model", () => model);

const dbs = new DbService();
const coach = new CoachService(new SettingsService(dbs));
const owner = `readout-${Date.now()}@t.co`;
const push = { send: vi.fn(async () => ({ sent: 1 })) };
const svc = new ReadoutService(coach, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, push as never);
const today = new Date().toISOString().slice(0, 10); // owner has no timezone -> UTC
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const call = (toolName: string, input: unknown) => ({ type: "tool-call" as const, toolCallId: toolName, toolName, input: JSON.stringify(input) });

beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await dbs.db.delete(userSettings).where(eq(userSettings.ownerEmail, owner));
  await dbs.onModuleDestroy();
});

test("agent tool calls save the readout and push it", async () => {
  const { MockLanguageModelV2 } = await import("ai/test");
  let step = 0;
  model.coachModel.mockResolvedValue(
    new MockLanguageModelV2({
      doGenerate: async () =>
        step++ === 0
          ? { content: [call("save-readout", { date: today, directive: "Easy day.", highlights: [] }), call("manage-notifications", { title: "Morning", body: "Easy day." })], finishReason: "tool-calls", usage, warnings: [] }
          : { content: [{ type: "text", text: "done" }], finishReason: "stop", usage, warnings: [] },
    }),
  );
  expect(await svc.generateFor(owner)).toEqual({ generated: true });
  expect(await coach.getReadout(owner)).toMatchObject({ date: today, directive: "Easy day." });
  expect(push.send).toHaveBeenCalledWith(owner, expect.objectContaining({ title: "Morning" }));
});

test("no model key: generated=false and nothing saved", async () => {
  const o = `${owner}.nokey`;
  model.coachModel.mockRejectedValue(new Error("no key"));
  expect(await svc.generateFor(o)).toEqual({ generated: false });
  expect(await coach.getReadout(o)).toBeNull();
  expect(push.send).not.toHaveBeenCalled();
});

test("generateText failure: generated=false", async () => {
  const { MockLanguageModelV2 } = await import("ai/test");
  model.coachModel.mockResolvedValue(new MockLanguageModelV2({ doGenerate: async () => { throw new Error("boom"); } }));
  const o = `${owner}.fail`;
  expect(await svc.generateFor(o)).toEqual({ generated: false });
  expect(await coach.getReadout(o)).toBeNull();
  expect(push.send).not.toHaveBeenCalled();
});

test("model that never calls save-readout: generated=false", async () => {
  const { MockLanguageModelV2 } = await import("ai/test");
  model.coachModel.mockResolvedValue(new MockLanguageModelV2({ doGenerate: async () => ({ content: [{ type: "text", text: "hi" }], finishReason: "stop", usage, warnings: [] }) }));
  expect(await svc.generateFor(`${owner}.skip`)).toEqual({ generated: false });
});
