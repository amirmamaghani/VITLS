import { describe, expect, it, vi } from "vitest";

process.env.EXPO_PUBLIC_VITLS_SERVER = "http://srv";

vi.mock("expo-secure-store", () => ({ getItemAsync: async () => "sess_x", setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-device", () => ({ modelName: "Test", osVersion: "1" }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-background-task", () => ({ registerTaskAsync: async () => {}, unregisterTaskAsync: async () => {}, BackgroundTaskResult: { Success: 1, Failed: 2 } }));
vi.mock("expo-task-manager", () => ({ defineTask: () => {} }));
vi.mock("expo/fetch", () => ({ fetch: async () => new Response("{}") }));
vi.mock("./health", () => ({ provider: "health_connect", read: async () => ({}), requestAccess: async () => true }));
vi.mock("./push", () => ({ ensurePushToken: async (s: unknown) => s }));

const { getToday } = await import("./api");

describe("session today client", () => {
  it("reads health + readout with the session bearer and maps the latest day", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("/api/coach/profile")
        ? new Response(JSON.stringify({ readout: { directive: "Rest.", highlights: [] } }))
        : new Response(JSON.stringify({ daily: { steps: { values: [{ date: "2026-10-10", value: 9000 }] } }, sleep: [{ durationMin: 433 }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const t = await getToday();
    expect(t.metrics.steps).toBe(9000);
    expect(t.readout?.directive).toBe("Rest.");
    const header = (fetchMock.mock.calls[0]![1] ?? {}).headers as Record<string, string>;
    expect(header.Authorization).toBe("Bearer sess_x");
  });
  it("throws 'unauthorized' on 401", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 }));
    await expect(getToday()).rejects.toThrow("unauthorized");
  });
});
