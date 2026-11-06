import { resourceGetByPath } from "@agent-native/core/resources";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { READOUT_JOB_PATH, getCoachProfile, updateCoachProfile } from "./profile";

const ana = "ana@example.com";

describe("coach profile", () => {
  beforeAll(setupTestDb);

  it("starts empty and not onboarded", async () => {
    expect(await getCoachProfile(ana)).toMatchObject({ profile: {}, onboarded: false, readoutScheduled: false });
  });

  it("merges patches", async () => {
    await updateCoachProfile(ana, { persona: "scientist", language: "sk" });
    await updateCoachProfile(ana, { goals: [{ module: "longevity", priority: 1, targets: {} }] });
    const { profile } = await getCoachProfile(ana);
    expect(profile).toMatchObject({ persona: "scientist", language: "sk", goals: [{ module: "longevity" }] });
  });

  it("schedules the morning readout as a personal job in the user's timezone", async () => {
    await updateCoachProfile(ana, { timezone: "Europe/Bratislava", readoutTime: "07:30" });
    const job = await resourceGetByPath(ana, READOUT_JOB_PATH);
    expect(job?.content).toContain('schedule: "30 7 * * *"');
    expect(job?.content).toContain('timezone: "Europe/Bratislava"');
    expect(job?.content).toContain("morning-readout");
    expect((await getCoachProfile(ana)).readoutScheduled).toBe(true);
  });

  it("removes the job when the readout is turned off", async () => {
    await updateCoachProfile(ana, { readoutTime: null });
    expect(await resourceGetByPath(ana, READOUT_JOB_PATH)).toBeNull();
  });

  it("stores birth year and sex and rejects out-of-range values", async () => {
    await updateCoachProfile(ana, { birthYear: 1990, sex: "female" });
    expect((await getCoachProfile(ana)).profile).toMatchObject({ birthYear: 1990, sex: "female" });
    await expect(updateCoachProfile(ana, { birthYear: 1899 })).rejects.toThrow();
    await expect(updateCoachProfile(ana, { birthYear: new Date().getFullYear() + 1 })).rejects.toThrow();
    await expect(updateCoachProfile(ana, { birthYear: 1990.5 })).rejects.toThrow();
    await expect(updateCoachProfile(ana, { sex: "other" } as never)).rejects.toThrow();
  });

  it("rejects invalid values", async () => {
    await expect(updateCoachProfile(ana, { readoutTime: "25:00" } as never)).rejects.toThrow();
  });
});
