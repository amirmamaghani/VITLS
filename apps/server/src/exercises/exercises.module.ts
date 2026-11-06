import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ExercisesController } from "./exercises.controller";
import { ExercisesService } from "./exercises.service";

// SettingsService comes from the @Global SettingsModule; AuthModule supplies AUTH for AuthGuard.
@Module({ imports: [AuthModule], controllers: [ExercisesController], providers: [ExercisesService], exports: [ExercisesService] })
export class ExercisesModule {}
