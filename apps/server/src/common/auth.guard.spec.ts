import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard";

function ctxWith(headers: Record<string, string>): ExecutionContext {
  const req: { headers: Record<string, string>; user?: { email: string } } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext & { __req: typeof req };
}

describe("AuthGuard", () => {
  it("rejects a request with no session", async () => {
    const auth = { api: { getSession: vi.fn().mockResolvedValue(null) } };
    const guard = new AuthGuard(auth as never);
    await expect(guard.canActivate(ctxWith({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("attaches the session user email and allows the request", async () => {
    const auth = { api: { getSession: vi.fn().mockResolvedValue({ user: { email: "A@B.CO" } }) } };
    const guard = new AuthGuard(auth as never);
    const req: { headers: Record<string, string>; user?: { email: string } } = { headers: {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ email: "a@b.co" });
  });
});

describe("AuthGuard bearer", () => {
  it("authenticates an Authorization: Bearer request and forwards the header to getSession", async () => {
    const getSession = vi.fn().mockResolvedValue({ user: { email: "Native@B.CO" } });
    const guard = new AuthGuard({ api: { getSession } } as never);
    const req: { headers: Record<string, string>; user?: { email: string } } = { headers: { authorization: "Bearer tok123" } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ email: "native@b.co" });
    expect(getSession.mock.calls[0]?.[0]?.headers.get("authorization")).toBe("Bearer tok123");
  });
});
