import { mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import handler, { MAGIC_LINK_ROUTE } from "./sign-in.post";

const post = (body: unknown) =>
  mockEvent("http://10.0.0.5:8081/api/devices/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/devices/sign-in", () => {
  beforeAll(setupTestDb);

  it("forwards the e-mail to the framework's magic-link route on the request origin", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => (calls.push({ url: url.toString(), body: String(init.body) }), new Response("{}", { status: 200 })));
    expect(await handler(post({ email: "ann@example.com" }))).toEqual({ ok: true });
    expect(calls[0]?.url).toBe(`http://10.0.0.5:8081${MAGIC_LINK_ROUTE}`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ email: "ann@example.com", callbackURL: "/home" });
    expect(MAGIC_LINK_ROUTE.endsWith("/auth/magic-link")).toBe(true);
  });

  it("rejects a malformed e-mail before calling the framework", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await handler(post({ email: "nope" }))).toMatchObject({ errorCode: "invalid_payload" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the framework's refusal through", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Use Google to sign in" }), { status: 403 }));
    expect(await handler(post({ email: "bob@example.com" }))).toMatchObject({ errorCode: "sign_in_failed", error: "Use Google to sign in" });
  });
});
