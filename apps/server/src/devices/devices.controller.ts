/** Device-facing HTTP surface (frozen paths/shapes): pairing redemption, email sign-in, push tokens. */
import { createHash } from "node:crypto";

import { Body, Controller, Delete, HttpCode, HttpException, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { LIMITS } from "../common/rate-limit/limits";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { AUTH } from "../auth/auth.module";
import type { Auth } from "../auth/auth";
import { DeviceGuard } from "./device.guard";
import { DevicesService } from "./devices.service";
import { PushService } from "./push.service";

const deviceInfo = z.object({ platform: z.enum(["ios", "android", "cli"]), model: z.string().optional(), appVersion: z.string().optional() });
const redeemBody = z.object({ code: z.string().min(12).max(20), device: deviceInfo });
const pairBody = z.object({ device: deviceInfo });

const signInBody = z.object({ email: z.string().email().max(200) });

interface DeviceRequest extends Request {
  device?: { deviceId: string; userEmail: string; scope: string };
}

@Controller("api/devices")
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly push: PushService,
    private readonly rateLimit: RateLimitService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Post("redeem")
  @HttpCode(200)
  async redeem(@Req() req: Request, @Body() rawBody: unknown) {
    await this.throttleRedeem(req);
    const { code, device } = redeemBody.parse(rawBody);
    const { token, deviceId } = await this.devices.redeemPairing(code, device);
    return { token, deviceId, ingestUrl: "/api/ingest/v1/batches" };
  }

  /** Session-authed self-pair: the signed-in phone gets a device token without a code (same phone, no retyping). */
  @Post("pair")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async pair(@CurrentUser() owner: string, @Body() rawBody: unknown) {
    const { device } = pairBody.parse(rawBody);
    const { token, deviceId } = await this.devices.selfPair(owner, device);
    return { token, deviceId, ingestUrl: "/api/ingest/v1/batches" };
  }

  @Post("sign-in")
  @HttpCode(200)
  async signIn(@Req() req: Request, @Body() rawBody: unknown) {
    await this.throttleRedeem(req);
    const { email } = signInBody.parse(rawBody);
    try {
      await this.auth.api.signInMagicLink({ body: { email, callbackURL: "/home" }, headers: new Headers() });
    } catch (error) {
      const status = (error as { status?: number; statusCode?: number }).statusCode ?? (error as { status?: number }).status ?? 500;
      throw new HttpException({ error: "Could not send sign-in link", errorCode: "sign_in_failed" }, typeof status === "number" ? status : 500);
    }
    return { ok: true };
  }

  @Post("push")
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  async addPush(@Req() req: DeviceRequest, @Body() rawBody: unknown) {
    const { expoToken, label } = z
      .object({ expoToken: z.string().refine((t) => this.push.isExpoPushToken(t), "Invalid Expo push token"), label: z.string().optional() })
      .parse(rawBody);
    await this.push.addExpoToken(req.device!.userEmail, expoToken, label, req.device!.deviceId);
    return { ok: true };
  }

  @Delete("push")
  @UseGuards(DeviceGuard)
  async removePush(@Req() req: DeviceRequest, @Body() rawBody: unknown) {
    const { expoToken } = z.object({ expoToken: z.string() }).parse(rawBody);
    await this.push.removeExpoToken(req.device!.userEmail, expoToken);
    return { ok: true };
  }

  /**
   * Throttles unauthenticated pairing redemption/sign-in globally (resource backstop) and per client.
   * Client address trusts only the platform-set Netlify header, never client-controlled X-Forwarded-For.
   */
  private async throttleRedeem(req: Request): Promise<void> {
    const tooMany = (message: string) => new HttpException({ error: message, errorCode: "rate_limited" }, 429);
    if (!(await this.rateLimit.hitRateLimit("redeem:global", LIMITS.redeemGlobal))) {
      throw tooMany("Pairing is busy, try again in a minute");
    }
    const nf = req.headers["x-nf-client-connection-ip"];
    const address = (Array.isArray(nf) ? nf[0] : nf) ?? req.ip ?? "unknown";
    const client = createHash("sha256").update(address).digest("hex").slice(0, 32);
    if (!(await this.rateLimit.hitRateLimit(`redeem:client:${client}`, LIMITS.redeemPerClient))) {
      throw tooMany("Too many pairing attempts, try again in a minute");
    }
  }
}
