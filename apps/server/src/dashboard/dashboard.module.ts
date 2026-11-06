import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardStore } from "./dashboard.store";

@Module({ imports: [AuthModule], controllers: [DashboardController], providers: [DashboardStore], exports: [DashboardStore] })
export class DashboardModule {}
