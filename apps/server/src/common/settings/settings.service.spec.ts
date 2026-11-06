import { eq } from "drizzle-orm";
import { userSettings } from "../../db/schema";
import { DbService } from "../db/db.service";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  const db = new DbService();
  const svc = new SettingsService(db);
  afterAll(async () => {
    await db.db.delete(userSettings).where(eq(userSettings.ownerEmail, "s@t.co"));
    await db.onModuleDestroy();
  });

  test("round-trips a value and isolates by owner", async () => {
    await svc.put("s@t.co", "k", { a: 1 });
    expect(await svc.get("s@t.co", "k")).toEqual({ a: 1 });
    expect(await svc.get("other@t.co", "k")).toBeNull();
  });

  test("defaults timezone to UTC, reads it when present", async () => {
    expect(await svc.timezone("s@t.co")).toBe("UTC");
    await svc.put("s@t.co", "vitls-coach", { timezone: "Europe/Bratislava" });
    expect(await svc.timezone("s@t.co")).toBe("Europe/Bratislava");
  });
});
