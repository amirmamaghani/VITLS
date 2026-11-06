import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { IngestModule } from "../ingest/ingest.module";
import { MealsModule } from "../meals/meals.module";
import { HealthReadController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({ imports: [AuthModule, MealsModule, IngestModule], controllers: [HealthReadController], providers: [HealthService], exports: [HealthService] })
export class HealthModule {}
