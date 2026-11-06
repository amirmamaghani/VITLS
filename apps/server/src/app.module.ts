import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./common/db/db.module";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { SettingsModule } from "./common/settings/settings.module";
import { CoachModule } from "./coach/coach.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DevicesModule } from "./devices/devices.module";
import { ExercisesModule } from "./exercises/exercises.module";
import { HealthController } from "./health.controller";
import { HealthModule } from "./health/health.module";
import { IngestModule } from "./ingest/ingest.module";
import { MealsModule } from "./meals/meals.module";
import { SharesModule } from "./shares/shares.module";

@Module({ imports: [ScheduleModule.forRoot(), DbModule, RateLimitModule, SettingsModule, AuthModule, DevicesModule, IngestModule, MealsModule, ExercisesModule, HealthModule, DashboardModule, CoachModule, SharesModule], controllers: [HealthController] })
export class AppModule {}
