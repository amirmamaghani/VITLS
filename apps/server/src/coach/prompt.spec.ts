import { eq } from "drizzle-orm";
import { userSettings } from "../db/schema";
import { DbService } from "../common/db/db.service";
import { SettingsService } from "../common/settings/settings.service";
import { CoachService } from "./coach.service";
import { coachMemories } from "../db/schema";
import { MemoriesService } from "./memories.service";
import { COACH_SYSTEM_PROMPT, coachContext, coachSystem } from "./prompt";

describe("coach prompt", () => {
  const seeded = "prompt-seeded@t.co";
  const empty = "prompt-empty@t.co";
  const db = new DbService();
  const coach = new CoachService(new SettingsService(db));
  afterAll(async () => {
    for (const o of [seeded, empty]) await db.db.delete(userSettings).where(eq(userSettings.ownerEmail, o));
    await db.onModuleDestroy();
  });

  test("seeded profile renders the coach-profile and devices blocks", async () => {
    await coach.updateProfile(seeded, {
      persona: "scientist", timezone: "Europe/Bratislava", readoutTime: "07:30", onboardingStage: "goals",
      goals: [{ module: "strength", priority: 1, targets: {} }],
    });
    const ctx = await coachContext(seeded, coach, db);
    expect(ctx).toContain("<coach-profile>");
    expect(ctx).toContain("persona: Scientist — ");
    expect(ctx).toContain("(Europe/Bratislava)");
    expect(ctx).toContain("goals: strength (priority 1)");
    expect(ctx).toContain('in progress, stage "goals"');
    expect(ctx).toContain("morning readout: scheduled at 07:30");
    expect(ctx).toContain("<devices>");
    expect(ctx).toContain("training_readiness, resting_hr");
    expect((await coachSystem(seeded, coach, db)).startsWith(COACH_SYSTEM_PROMPT + "\n\n<coach-profile>")).toBe(true);
  });

  test("empty profile falls back and does not throw", async () => {
    const ctx = await coachContext(empty, coach, db);
    for (const s of ["persona: not chosen yet", "goals: none yet", "timezone unknown", "language: not set", "morning readout: not scheduled", "strictness: balanced", "units: metric"])
      expect(ctx).toContain(s);
  });

  test("system prompt carries the safety rule and the playbook", () => {
    expect(COACH_SYSTEM_PROMPT).toContain("You are a coach, not a doctor");
    expect(COACH_SYSTEM_PROMPT).toContain("Onboarding playbook");
  });

  describe("memories block", () => {
    const owner = "prompt-mem@t.co";
    const memories = new MemoriesService(db);
    afterAll(async () => { await db.db.delete(coachMemories).where(eq(coachMemories.ownerEmail, owner)); });

    test("injects only the relevant memory, after devices", async () => {
      await memories.save(owner, { name: "knee-injury", type: "user", description: "left knee pain in squats", content: "Avoid deep squats." });
      await memories.save(owner, { name: "mornings", type: "user", description: "prefers training early", content: "Trains at 6am." });
      const sys = await coachSystem(owner, coach, db, { memories, query: "my knee hurts in squats" });
      expect(sys).toContain("<memories>\n- knee-injury: left knee pain in squats — Avoid deep squats.\n</memories>");
      expect(sys).not.toContain("mornings");
      expect(sys.indexOf("<memories>")).toBeGreaterThan(sys.indexOf("</devices>"));
    });

    test("no match, empty query or no opts omit the block", async () => {
      expect(await coachSystem(owner, coach, db, { memories, query: "zzz" })).not.toContain("<memories>");
      expect(await coachSystem(owner, coach, db, { memories, query: "" })).not.toContain("<memories>");
      expect(await coachSystem(owner, coach, db)).not.toContain("<memories>");
    });
  });
});
