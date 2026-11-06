import { describe, expect, it, vi } from "vitest";

import * as foodPhoto from "./food-photo";
import { buildCoachTools, type CoachToolServices } from "./tools";

const OWNER = "a@b.co";
const stubs = () => ({
  coach: { getProfile: vi.fn(), getReadout: vi.fn(), updateProfile: vi.fn(), saveReadout: vi.fn(async (_o: string, r: unknown) => r), setLocalization: vi.fn(async (_o: string, l: unknown) => l) },
  memories: { save: vi.fn(async () => undefined) },
  push: { send: vi.fn(async () => ({ sent: 2 })) },
  health: { getHealth: vi.fn(async () => ({ daily: [] })), getDataCatalog: vi.fn(), getHealthRaw: vi.fn(), logManual: vi.fn() },
  foods: { search: vi.fn() },
  meals: { logMeal: vi.fn(), deleteMeal: vi.fn(async () => { throw new Error("db down"); }), createFood: vi.fn() },
  exercises: { search: vi.fn(), getTrainingPlan: vi.fn(), saveTrainingPlan: vi.fn() },
  dashboards: { get: vi.fn(), list: vi.fn(), write: vi.fn(), archive: vi.fn(), listRevisionMetadata: vi.fn(), restore: vi.fn(), defaultDashboardId: vi.fn() },
  devices: { createPairing: vi.fn() },
});
const run = (t: unknown, input: unknown) => (t as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "1", messages: [] });

describe("buildCoachTools", () => {
  it("exposes every tool", async () => {
    const tools = await buildCoachTools(OWNER, stubs() as unknown as CoachToolServices);
    expect(Object.keys(tools).sort()).toEqual(
      ["archive-dashboard", "ask-question", "create-dashboard", "create-device-pairing", "create-food", "delete-meal", "get-coach-profile", "get-dashboard", "get-data-catalog", "get-health", "get-health-raw", "get-training-plan", "list-dashboard-revisions", "list-dashboards", "log-health-data", "log-meal", "restore-dashboard-revision", "save-dashboard", "save-training-plan", "search-exercises", "search-foods", "show-widget", "update-coach-profile", "save-readout", "save-memory", "set-localization-preference", "manage-notifications", "analyze-food-photo"].sort(),
    );
  });

  it("analyze-food-photo returns the analysed items", async () => {
    const items = [{ name: "Banana", grams: 118, nutrients: { energy_kcal: 105 } }];
    const spy = vi.spyOn(foodPhoto, "analyzeFoodPhoto").mockResolvedValue({ items });
    const tools = await buildCoachTools(OWNER, stubs() as unknown as CoachToolServices);
    expect(await run(tools["analyze-food-photo"], { imageBase64: "abc", note: "lunch" })).toEqual({ items });
    expect(spy).toHaveBeenCalledWith("abc", "lunch");
    spy.mockRestore();
  });

  it("get-health calls the service with the owner", async () => {
    const s = stubs();
    const tools = await buildCoachTools(OWNER, s as unknown as CoachToolServices);
    expect(await run(tools["get-health"], { from: "2026-01-01", to: "2026-01-05" })).toEqual({ daily: [] });
    expect(s.health.getHealth).toHaveBeenCalledWith(OWNER, expect.objectContaining({ from: "2026-01-01", to: "2026-01-05" }));
  });

  it("show-widget echoes a valid widget and rejects an invalid one", async () => {
    const tools = await buildCoachTools(OWNER, stubs() as unknown as CoachToolServices);
    const schema = (tools["show-widget"] as unknown as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
    const good = { widget: { kind: "metric", metric: "steps", range: "7d" } };
    expect(schema.safeParse(good).success).toBe(true);
    expect(await run(tools["show-widget"], good)).toEqual(good);
    expect(schema.safeParse({ widget: { kind: "nope" } }).success).toBe(false);
  });

  it("a throwing service rejects execute", async () => {
    const tools = await buildCoachTools(OWNER, stubs() as unknown as CoachToolServices);
    await expect(run(tools["delete-meal"], { mealId: "m1" })).rejects.toThrow("db down");
  });

  it("new tools call their services with the owner", async () => {
    const s = stubs();
    const tools = await buildCoachTools(OWNER, s as unknown as CoachToolServices);
    const readout = { date: "2026-10-12", directive: "Rest.", highlights: [] };
    expect(await run(tools["save-readout"], readout)).toEqual({ readout, message: "Readout saved." });
    expect(s.coach.saveReadout).toHaveBeenCalledWith(OWNER, readout);
    const mem = { name: "n", type: "user", description: "d", content: "c" };
    expect(await run(tools["save-memory"], mem)).toEqual({ message: "Saved." });
    expect(s.memories.save).toHaveBeenCalledWith(OWNER, mem);
    expect(await run(tools["set-localization-preference"], { locale: "de" })).toEqual({ localization: { locale: "de" }, message: "Localization updated." });
    expect(s.coach.setLocalization).toHaveBeenCalledWith(OWNER, { locale: "de" });
    expect(await run(tools["manage-notifications"], { title: "Hi", body: "b", url: "/x" })).toEqual({ sent: 2, message: "Notification sent." });
    expect(s.push.send).toHaveBeenCalledWith(OWNER, { title: "Hi", body: "b", data: { url: "/x" } });
  });

  it("manage-notifications rejects when push fails", async () => {
    const s = stubs();
    s.push.send.mockRejectedValueOnce(new Error("expo down"));
    const tools = await buildCoachTools(OWNER, s as unknown as CoachToolServices);
    await expect(run(tools["manage-notifications"], { title: "Hi" })).rejects.toThrow("expo down");
  });
});
