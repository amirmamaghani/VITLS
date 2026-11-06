import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";
import { AUTH } from "../auth/auth.module";
import type { Auth } from "../auth/auth";

/** Validates the BetterAuth session (cookie, or `Authorization: Bearer` via the bearer plugin) and attaches `req.user = { email }`. 401 when absent. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: IncomingHttpHeaders; user?: { email: string } }>();
    // better-auth/node is ESM-only; this server is CJS, so import it dynamically (as app.factory.ts does).
    const { fromNodeHeaders } = await import("better-auth/node");
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.email) throw new UnauthorizedException();
    req.user = { email: session.user.email.trim().toLowerCase() };
    return true;
  }
}
