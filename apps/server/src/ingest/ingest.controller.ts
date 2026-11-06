/**
 * POST /api/ingest/v1/batches — device batch ingest (companion app, dev sources).
 * Auth: `Authorization: Bearer vdt_…` device token (write-only), enforced by DeviceGuard. Never cookies.
 * See docs/design/02-data-model-and-ingest.md §5.
 */
import { Body, Controller, HttpCode, HttpException, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { LIMITS } from "../common/rate-limit/limits";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { DeviceGuard } from "../devices/device.guard";
import { DevicesService } from "../devices/devices.service";
import { EntitlementsService } from "./entitlements.service";
import { IngestService } from "./ingest.service";

interface DeviceRequest extends Request {
  device?: { deviceId: string; userEmail: string; scope: string };
}

@Controller("api/ingest/v1")
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly entitlements: EntitlementsService,
    private readonly devices: DevicesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post("batches")
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  async batches(@Req() req: DeviceRequest, @Body() rawBody: unknown) {
    const device = req.device!;
    // @vitls/health-ingest is ESM-only; this CJS server loads it dynamically (same pattern as better-auth in app.factory).
    const { INGEST_LIMITS, ingestBatchSchema } = await import("@vitls/health-ingest");
    await this.chargeIngestBytes(device.deviceId, req, rawBody, INGEST_LIMITS.maxBodyBytes);
    const batch = ingestBatchSchema.parse(rawBody);
    const entitlements = await this.entitlements.getEntitlements();
    const result = await this.ingest.ingestBatch({
      identity: device,
      batch,
      // guard:allow-env-credential — deploy-level feature flag (never set in production), not a credential
      allowDevSources: process.env.VITLS_ENABLE_DEV_SOURCES === "1",
      entitlements,
    });
    await this.devices.touchDevice(device.deviceId, device.userEmail);
    return { batchId: result.batchId, duplicate: result.duplicate, stored: result.stored, skipped: result.skipped, plan: entitlements.plan };
  }

  /**
   * Counts body bytes toward the per-device daily quota before validating. Charges the declared
   * Content-Length (capped at the body limit) so oversized/malformed bodies still cost; chunked
   * bodies with no finite length are charged by their serialized size.
   */
  private async chargeIngestBytes(deviceId: string, req: Request, body: unknown, maxBodyBytes: number): Promise<void> {
    const declared = Number(req.headers["content-length"]);
    const bytes =
      Number.isFinite(declared) && declared > 0 ? Math.min(declared, maxBodyBytes) : Buffer.byteLength(JSON.stringify(body));
    if (!(await this.rateLimit.hitRateLimit(`ingest:bytes:${deviceId}`, LIMITS.ingestBytes, bytes))) {
      throw new HttpException({ error: "Daily ingest quota exceeded for this device", errorCode: "rate_limited" }, 429);
    }
  }
}
