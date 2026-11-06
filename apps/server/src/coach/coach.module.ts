import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { DevicesModule } from "../devices/devices.module";
import { ExercisesModule } from "../exercises/exercises.module";
import { HealthModule } from "../health/health.module";
import { MealsModule } from "../meals/meals.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatThreadStore } from "./chat-thread.store";
import { MemoriesService } from "./memories.service";
import { CoachController } from "./coach.controller";
import { CoachService } from "./coach.service";
import { ReadoutCron } from "./readout.cron";
import { ReadoutService } from "./readout.service";

@Module({
  imports: [AuthModule, HealthModule, MealsModule, ExercisesModule, DashboardModule, DevicesModule],
  controllers: [CoachController, ChatController],
  providers: [CoachService, ChatThreadStore, ChatService, MemoriesService, ReadoutService, ReadoutCron],
  exports: [CoachService, MemoriesService],
})
export class CoachModule {}
