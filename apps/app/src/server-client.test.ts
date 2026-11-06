import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const expoFetch = vi.fn();
vi.mock("expo-secure-store", () => ({
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  getItemAsync: async (k: string) => store.get(k) ?? null,
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
vi.mock("expo/fetch", () => ({ fetch: (...a: unknown[]) => expoFetch(...a) }));

const S = "https://vitls.example";
let c: typeof import("./server-client");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeAll(async () => {
  process.env.EXPO_PUBLIC_VITLS_SERVER = S;
  c = await import("./server-client");
});
beforeEach(() => {
  store.clear();
  expoFetch.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("server-client", () => {
  it("round-trips the session under its own key", async () => {
    await c.saveSession("tok");
    expect(await c.loadSession()).toBe("tok");
    expect([...store.keys()]).toEqual(["vitls-session"]);
    await c.clearSession();
    expect(await c.loadSession()).toBeNull();
  });

  it("apiGet sends the bearer header, query and parses JSON", async () => {
    await c.saveSession("tok");
    vi.mocked(fetch).mockResolvedValue(json(200, { a: 1 }));
    expect(await c.apiGet("/api/x", { q: "1" })).toEqual({ a: 1 });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${S}/api/x?q=1`);
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("401 throws Unauthorized and clears the session; no session throws too", async () => {
    await expect(c.apiGet("/api/x")).rejects.toBeInstanceOf(c.Unauthorized);
    await c.saveSession("tok");
    vi.mocked(fetch).mockResolvedValue(json(401, {}));
    await expect(c.apiPost("/api/x", {})).rejects.toBeInstanceOf(c.Unauthorized);
    expect(await c.loadSession()).toBeNull();
  });

  it("other errors surface the server message", async () => {
    await c.saveSession("tok");
    vi.mocked(fetch).mockResolvedValue(json(400, { error: "bad" }));
    await expect(c.apiGet("/api/x")).rejects.toThrow("bad");
  });

  it("chatStream posts via expo/fetch with bearer and signal", async () => {
    await c.saveSession("tok");
    const ac = new AbortController();
    expoFetch.mockResolvedValue(json(200, {}));
    await c.chatStream({ m: 1 }, { signal: ac.signal });
    const [url, init] = expoFetch.mock.calls[0];
    expect(url).toBe(`${S}/api/chat`);
    expect(init.signal).toBe(ac.signal);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("captureSession stores set-auth-token from the verify response", async () => {
    expoFetch.mockResolvedValue(new Response(null, { status: 200, headers: { "set-auth-token": "tok" } }));
    expect(await c.captureSession(`${S}/_vitls/auth/magic-link/verify?token=a`)).toBe(true);
    expect(expoFetch.mock.calls[0][1]).toEqual({ redirect: "manual" });
    expect(await c.loadSession()).toBe("tok");
  });

  it("captureSession verifies a link only once even when called twice (StrictMode)", async () => {
    expoFetch.mockResolvedValue(new Response(null, { status: 200, headers: { "set-auth-token": "tok" } }));
    const u = `${S}/_vitls/auth/magic-link/verify?token=once`;
    expect(await Promise.all([c.captureSession(u), c.captureSession(u)])).toEqual([true, true]);
    expect(expoFetch).toHaveBeenCalledTimes(1);
    expect(await c.loadSession()).toBe("tok");
  });

  it("captureSession refuses foreign origins and token-less responses", async () => {
    expect(await c.captureSession("https://evil.example/x")).toBe(false);
    expect(expoFetch).not.toHaveBeenCalled();
    expoFetch.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await c.captureSession(`${S}/_vitls/auth/magic-link/verify?token=none`)).toBe(false);
    expect(await c.loadSession()).toBeNull();
  });
});
