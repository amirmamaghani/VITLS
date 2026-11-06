import { Module } from "@nestjs/common";

import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { DevicesModule } from "../devices/devices.module";
import { EntitlementsService } from "./entitlements.service";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

// DbService comes from the @Global DbModule; DevicesModule exports DeviceGuard + DevicesService.
@Module({
  imports: [RateLimitModule, DevicesModule],
  controllers: [IngestController],
  providers: [IngestService, EntitlementsService],
  exports: [IngestService],
})
export class IngestModule {}
