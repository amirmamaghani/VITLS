import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { DevicesController } from "./devices.controller";
import { DeviceGuard } from "./device.guard";
import { PushService } from "./push.service";
import { DevicesService } from "./devices.service";

@Module({
  imports: [RateLimitModule, AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceGuard, PushService, { provide: APP_FILTER, useClass: HttpExceptionFilter }],
  exports: [DevicesService, DeviceGuard, PushService],
})
export class DevicesModule {}
