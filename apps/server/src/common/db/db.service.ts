import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly sql = postgres(
    process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required"); })(),
  );
  readonly db = drizzle(this.sql, { schema });
  async onModuleDestroy() {
    await this.sql.end();
  }
}
