import { describe, expect, it } from "vitest";

import { buildMacros, buildToday, formatMinutes, formatSyncAge, isStale } from "./today";

describe("buildMacros", () => {
  it("sums meal totals and carries optional goals", () => {
    const meals = [{ totals: { energy: 320, protein: 20, carbs: 30, fat: 8 } }, { totals: { energy: 540, protein: 38, carbs: 46 } }];
    expect(buildMacros(meals, { kcal: 2100, protein: 140 })).toEqual({
      kcal: { eaten: 860, goal: 2100 },
      protein: { g: 58, goal: 140 },
      carbs: { g: 76, goal: undefined },
      fat: { g: 8, goal: undefined },
    });
  });
  it("tolerates missing nutrients and no goals", () => {
    expect(buildMacros([{ totals: {} }])).toEqual({ kcal: { eaten: 0, goal: undefined }, protein: { g: 0, goal: undefined }, carbs: { g: 0, goal: undefined }, fat: { g: 0, goal: undefined } });
  });
});

describe("buildToday", () => {
  it("takes the latest day per metric and the most recent sleep night", () => {
    const t = buildToday(
      {
        daily: { steps: { values: [{ date: "2026-10-09", value: 100 }, { date: "2026-10-10", value: 9000 }] }, resting_hr: { values: [{ date: "2026-10-10", value: 52 }] } },
        sleep: [{ durationMin: 400 }, { durationMin: 433 }],
      },
      { directive: "Easy day.", highlights: [] },
      "2026-10-10",
    );
    expect(t).toEqual({ date: "2026-10-10", readout: { directive: "Easy day.", highlights: [] }, metrics: { steps: 9000, resting_hr: 52, sleep_min: 433 } });
  });
  it("leaves metrics undefined when the sections are empty", () => {
    expect(buildToday({}, null, "2026-10-10").metrics).toEqual({ steps: undefined, resting_hr: undefined, sleep_min: undefined });
  });
});

describe("today helpers", () => {
  it("formats sleep minutes", () => {
    expect(formatMinutes(452)).toBe("7 h 32 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
  it("formats sync age", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(formatSyncAge(null, now)).toBe("no data yet");
    expect(formatSyncAge("2026-10-10T11:55:00Z", now)).toBe("5 min ago");
    expect(formatSyncAge("2026-10-10T09:00:00Z", now)).toBe("3 h ago");
    expect(formatSyncAge("2026-10-08T09:00:00Z", now)).toBe("2 days ago");
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-11T08:00:00Z");
  it("is stale without a sync", () => expect(isStale(undefined, now)).toBe(true));
  it("is fresh within ten minutes", () => expect(isStale("2026-10-11T07:55:00Z", now)).toBe(false));
  it("is stale at ten minutes and beyond", () => {
    expect(isStale("2026-10-11T07:50:00Z", now)).toBe(true);
    expect(isStale("2026-10-10T19:18:00Z", now)).toBe(true);
  });
});
