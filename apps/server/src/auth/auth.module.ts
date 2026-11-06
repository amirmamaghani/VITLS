import { Module } from "@nestjs/common";

import { DbService } from "../common/db/db.service";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { buildAuth } from "./auth";

/** Injection token for the shared BetterAuth instance (main.ts mounts its handler on Express). */
export const AUTH = Symbol("BETTER_AUTH");

@Module({
  imports: [MailModule],
  providers: [
    {
      provide: AUTH,
      inject: [DbService, MailService],
      useFactory: (db: DbService, mail: MailService) => buildAuth(db.db, mail),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
