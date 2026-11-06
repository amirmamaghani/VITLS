import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FoodsService } from "./foods.service";
import { MealsController } from "./meals.controller";
import { MealsService } from "./meals.service";

// DbService / SettingsService come from the @Global modules; AuthModule supplies AUTH for AuthGuard.
@Module({ imports: [AuthModule], controllers: [MealsController], providers: [MealsService, FoodsService], exports: [MealsService, FoodsService] })
export class MealsModule {}
