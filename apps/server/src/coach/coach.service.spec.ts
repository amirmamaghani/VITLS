import { eq } from "drizzle-orm";
import { userSettings } from "../db/schema";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import { CoachService } from "./coach.service";

describe("CoachService", () => {
  const owner = "coach-svc@t.co";
  const db = new DbService();
  const settings = new SettingsService(db);
  const svc = new CoachService(settings);
  afterAll(async () => {
    await db.db.delete(userSettings).where(eq(userSettings.ownerEmail, owner));
    await db.onModuleDestroy();
  });

  test("updateProfile round-trips and merges patches", async () => {
    await svc.updateProfile(owner, { persona: "strict", timezone: "Europe/Bratislava", goals: [{ module: "strength", priority: 1, targets: {} }] });
    await svc.updateProfile(owner, { units: "imperial" });
    const { profile, onboarded } = await svc.getProfile(owner);
    expect(profile).toMatchObject({ persona: "strict", timezone: "Europe/Bratislava", units: "imperial" });
    expect(profile.goals?.[0]?.module).toBe("strength");
    expect(onboarded).toBe(false);
  });

  test("readoutScheduled follows readoutTime", async () => {
    const o = "coach-svc-ro@t.co";
    expect((await svc.getProfile(o)).readoutScheduled).toBe(false);
    await svc.updateProfile(o, { readoutTime: "07:30" });
    expect((await svc.getProfile(o)).readoutScheduled).toBe(true);
    await svc.updateProfile(o, { readoutTime: null });
    expect((await svc.getProfile(o)).readoutScheduled).toBe(false);
    await db.db.delete(userSettings).where(eq(userSettings.ownerEmail, o));
  });

  test("readout round-trips", async () => {
    expect(await svc.getReadout(owner)).toBeNull();
    const r = { date: "2026-10-12", directive: "Easy day.", highlights: [{ metric: "hrv", note: "up 5%" }] };
    expect(await svc.saveReadout(owner, r)).toEqual(r);
    expect(await svc.getReadout(owner)).toEqual(r);
  });

  test("localization is stored apart from the profile timezone", async () => {
    await svc.setLocalization(owner, { timezone: "Asia/Tokyo" });
    expect(await svc.setLocalization(owner, { locale: "sk" })).toEqual({ timezone: "Asia/Tokyo", locale: "sk" });
    expect(await settings.get(owner, "localization")).toEqual({ timezone: "Asia/Tokyo", locale: "sk" });
    expect((await svc.getProfile(owner)).profile.timezone).toBe("Europe/Bratislava");
  });
});
