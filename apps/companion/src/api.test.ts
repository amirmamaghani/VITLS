import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-device", () => ({ modelName: "Test", osVersion: "1" }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-background-task", () => ({ registerTaskAsync: async () => {}, unregisterTaskAsync: async () => {}, BackgroundTaskResult: { Success: 1, Failed: 2 } }));
vi.mock("expo-task-manager", () => ({ defineTask: () => {} }));
vi.mock("./health", () => ({ provider: "health_connect", read: async () => ({}), requestAccess: async () => true }));
vi.mock("./push", () => ({ ensurePushToken: async (s: unknown) => s }));

const { getToday, quickLog } = await import("./api");
const state = { server: "http://srv", token: "vdt_x", deviceId: "d1" };

describe("device api client", () => {
  it("sends the bearer token and returns json", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ date: "2026-10-10", readout: null, metrics: {}, lastBatchAt: null, missing: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getToday(state)).date).toBe("2026-10-10");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/devices/today");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer vdt_x");
  });
  it("throws 'unauthorized' on 401", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Invalid or revoked device token" }), { status: 401 }));
    await expect(quickLog(state, [{ metric: "weight", value: 80, date: "2026-10-10" }])).rejects.toThrow("unauthorized");
  });
});
