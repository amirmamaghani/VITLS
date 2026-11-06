import { type CanActivate, type ExecutionContext, HttpException, Injectable } from "@nestjs/common";

import { LIMITS } from "../common/rate-limit/limits";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { DevicesService } from "./devices.service";

/** Authenticates `Authorization: Bearer <device token>`, enforces ingest scope + per-device rate limit, sets req.device. */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly devices: DevicesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers?.authorization ?? "");
    const identity = match ? await this.devices.authenticateDeviceToken(match[1]!) : null;
    if (!identity) throw new HttpException({ error: "Invalid or revoked device token", errorCode: "unauthorized" }, 401);
    if (identity.scope !== "ingest:write") {
      throw new HttpException({ error: "Token not allowed to ingest", errorCode: "forbidden" }, 403);
    }
    if (!(await this.rateLimit.hitRateLimit(`ingest:req:${identity.deviceId}`, LIMITS.ingestRequests))) {
      throw new HttpException({ error: "Too many requests, slow down", errorCode: "rate_limited" }, 429);
    }
    req.device = { deviceId: identity.deviceId, userEmail: identity.userEmail, scope: identity.scope };
    return true;
  }
}
