import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SharesController } from "./shares.controller";
import { SharesService } from "./shares.service";

@Global()
@Module({ imports: [AuthModule], controllers: [SharesController], providers: [SharesService], exports: [SharesService] })
export class SharesModule {}
