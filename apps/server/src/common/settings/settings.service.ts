import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { userSettings as t } from "../../db/schema";
import { DbService } from "../db/db.service";

@Injectable()
export class SettingsService {
  constructor(private readonly dbs: DbService) {}

  async get<T>(ownerEmail: string, key: string): Promise<T | null> {
    const [row] = await this.dbs.db
      .select({ value: t.value })
      .from(t)
      .where(and(eq(t.ownerEmail, ownerEmail), eq(t.key, key)));
    return (row?.value as T | undefined) ?? null;
  }

  async put<T>(ownerEmail: string, key: string, value: T): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.dbs.db
      .insert(t)
      .values({ ownerEmail, key, value, updatedAt })
      .onConflictDoUpdate({ target: [t.ownerEmail, t.key], set: { value, updatedAt } });
  }

  // shortcut: UTC until Plan #3 coach-profile writes a timezone; local-day math for non-UTC users is corrected once the profile exists.
  async timezone(ownerEmail: string): Promise<string> {
    const tz = (await this.get<{ timezone?: unknown }>(ownerEmail, "vitls-coach"))?.timezone;
    return typeof tz === "string" && tz ? tz : "UTC";
  }
}
