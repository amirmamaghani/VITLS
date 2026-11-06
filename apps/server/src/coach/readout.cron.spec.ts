import { like } from "drizzle-orm";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import { userSettings } from "../db/schema";
import { CoachService } from "./coach.service";
import { ReadoutCron } from "./readout.cron";
import { localDateTime } from "./readout.service";

const model = vi.hoisted(() => ({ hasCoachKey: vi.fn(() => true), coachModel: vi.fn() }));
vi.mock("./model", () => model);

const dbs = new DbService();
const settings = new SettingsService(dbs);
const coach = new CoachService(settings);
const gen = vi.fn(async (_o: string) => ({ generated: true }));
// 2026-10-12 20:00Z = 2026-10-13 10:00 Kiritimati (UTC+14), 2026-10-12 10:00 Honolulu (UTC-10)
const NOW = new Date("2026-10-12T20:00:00Z");
let clock = NOW;
class FixedCron extends ReadoutCron {
  protected override now() { return clock; }
}
let cron = new FixedCron(dbs, coach, { generateFor: gen } as never);
const p = `cron-${Date.now()}`;
const kiri = `${p}-kiri@t.co`;
const hono = `${p}-hono@t.co`;
const setup = (o: string, tz: string, readoutTime: string | null) => settings.put(o, "vitls-coach", { timezone: tz, readoutTime });

beforeEach(async () => {
  vi.clearAllMocks();
  clock = NOW;
  cron = new FixedCron(dbs, coach, { generateFor: gen } as never);
  model.hasCoachKey.mockReturnValue(true);
  await dbs.db.delete(userSettings).where(like(userSettings.ownerEmail, `${p}%`));
});
afterAll(async () => {
  await dbs.db.delete(userSettings).where(like(userSettings.ownerEmail, `${p}%`));
  await dbs.onModuleDestroy();
});
const called = () => gen.mock.calls.map((c) => c[0]).filter((o) => o.startsWith(p));

test("localDateTime resolves per timezone", () => {
  expect(localDateTime(NOW, "Pacific/Kiritimati")).toEqual({ date: "2026-10-13", time: "10:00" });
  expect(localDateTime(NOW, "Pacific/Honolulu")).toEqual({ date: "2026-10-12", time: "10:00" });
  expect(localDateTime(new Date("2026-10-12T10:05:00Z"), "UTC").time).toBe("10:05");
  expect(localDateTime(new Date("2026-10-12T00:05:00Z"), "UTC").time).toBe("00:05"); // not "24:05"
});

test("due user with no readout today runs once", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  await cron.handleTick();
  expect(called()).toEqual([kiri]);
});

test("readout time is per timezone: same instant, only the one past its local time runs", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30"); // local 10:00 -> due
  await setup(hono, "Pacific/Honolulu", "10:30"); // local 10:00 -> not yet
  await cron.handleTick();
  expect(called()).toEqual([kiri]);
});

test("already has today's local readout: skipped; yesterday's does not count", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  await coach.saveReadout(kiri, { date: "2026-10-13", directive: "x", highlights: [] });
  await setup(hono, "Pacific/Honolulu", "09:30");
  await coach.saveReadout(hono, { date: "2026-10-11", directive: "x", highlights: [] });
  await cron.handleTick();
  expect(called()).toEqual([hono]);
});

test("skips users without readoutTime or timezone", async () => {
  await setup(kiri, "Pacific/Kiritimati", null);
  await settings.put(hono, "vitls-coach", { readoutTime: "00:00" });
  await cron.handleTick();
  expect(called()).toEqual([]);
});

test("one user's failure does not stop the batch", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  await setup(hono, "Pacific/Honolulu", "09:30");
  gen.mockImplementationOnce(async () => { throw new Error("boom"); });
  await cron.handleTick();
  expect(called()).toHaveLength(2);
});

test("no coach key: no users processed", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  model.hasCoachKey.mockReturnValue(false);
  await cron.handleTick();
  expect(gen).not.toHaveBeenCalled();
});

test("an in-flight owner is not started again by a second tick", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  let release!: () => void;
  gen.mockImplementationOnce(() => new Promise((r) => { release = () => r({ generated: true }); }));
  const first = cron.handleTick();
  await vi.waitFor(() => expect(called()).toHaveLength(1));
  await cron.handleTick();
  expect(called()).toHaveLength(1);
  release();
  await first;
});

test("generated:false backs off for the cooldown, then retries", async () => {
  await setup(kiri, "Pacific/Kiritimati", "09:30");
  gen.mockResolvedValueOnce({ generated: false });
  await cron.handleTick();
  clock = new Date(NOW.getTime() + 5 * 60_000);
  await cron.handleTick();
  expect(called()).toHaveLength(1);
  clock = new Date(NOW.getTime() + 31 * 60_000);
  await cron.handleTick();
  expect(called()).toHaveLength(2);
});
