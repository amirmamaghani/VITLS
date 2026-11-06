import { describe, expect, it } from "vitest";

import {
  addDays, anomalies, calendarGrid, easyShare, energyBalance, liftSeries, longestPerWeek, muscleVolume, perDay, personalRecords,
  rangeOf, regularity, rollingBand, signed, sleepSchedule, sleepStages, streakDays, swimStats, weeklyVolume, zoneTotals,
} from "./widget-data";

const w = (type: string, start: string, extra: object = {}) => ({ type, start, durationMin: 60, ...extra });

describe("perDay", () => {
  it("returns daily values as they are and turns summed buckets into per-day averages", () => {
    const values = [{ date: "2026-10-01", value: 2400 }];
    expect(perDay({ values })).toEqual(values);
    expect(perDay({ values: [], buckets: [{ date: "2026-09-28", value: 14000, days: 7 }] })).toEqual([{ date: "2026-09-28", value: 2000 }]);
    expect(perDay(undefined)).toEqual([]);
  });
});

describe("streakDays", () => {
  it("counts consecutive ok days ending today and builds a Monday-aligned 28-day grid", () => {
    const days = [{ date: "2026-10-05", ok: true }, { date: "2026-10-06", ok: true }, { date: "2026-10-07", ok: true }, { date: "2026-10-04", ok: false }];
    const r = streakDays(days, "2026-10-07"); // Wednesday
    expect(r.current).toBe(3);
    expect(r.grid).toHaveLength(28);
    expect(r.grid[0]!.date).toBe("2026-09-14"); // Monday
    expect(r.grid.find((g) => g.date === "2026-10-05")!.ok).toBe(true);
    expect(r.grid.find((g) => g.date === "2026-10-04")!.ok).toBe(false);
    expect(r.grid.find((g) => g.date === "2026-10-08")!.ok).toBeNull();
  });
  it("is empty-safe", () => {
    const r = streakDays([], "2026-10-07");
    expect(r.current).toBe(0);
    expect(r.grid.every((g) => g.ok === null)).toBe(true);
  });
  it("does not break the streak when today is not logged yet", () => {
    expect(streakDays([{ date: "2026-10-06", ok: true }, { date: "2026-10-05", ok: true }], "2026-10-07").current).toBe(2);
  });
});

describe("zoneTotals / easyShare", () => {
  const ws = [w("Run", "2026-10-01T06:00:00Z", { zones: [{ zone: 1, seconds: 600 }, { zone: 2, seconds: 1200 }, { zone: 4, seconds: 600 }] }), w("Ride", "2026-10-02T06:00:00Z", { zones: [{ zone: 2, seconds: 600 }] })];
  it("sums seconds per zone and computes zone 1-2 share", () => {
    const t = zoneTotals(ws);
    expect(t).toEqual([{ zone: 1, seconds: 600 }, { zone: 2, seconds: 1800 }, { zone: 4, seconds: 600 }]);
    expect(easyShare(t)).toBeCloseTo(0.8, 5);
  });
  it("handles empty input", () => {
    expect(zoneTotals([])).toEqual([]);
    expect(easyShare([])).toBeNull();
  });
  it("excludes zone 0 from the easy share", () => {
    expect(easyShare([{ zone: 0, seconds: 500 }, { zone: 1, seconds: 500 }])).toBe(0.5);
  });
  it("ignores workouts without zones", () => {
    expect(zoneTotals([w("Run", "2026-10-01T06:00:00Z")])).toEqual([]);
  });
});

describe("weeklyVolume / longestPerWeek", () => {
  const ws = [
    w("Running", "2026-10-05T06:00:00Z", { distanceM: 10000, durationMin: 50 }), // Monday
    w("Trail run", "2026-10-11T06:00:00Z", { distanceM: 20000, durationMin: 120 }), // Sunday, same week
    w("Road cycling", "2026-10-06T06:00:00Z", { distanceM: 40000 }),
    w("Running", "2026-09-21T06:00:00Z", { distanceM: 5000, durationMin: 25 }),
  ];
  it("groups by ISO week (Monday) per sport", () => {
    expect(weeklyVolume(ws, "run")).toEqual([
      { week: "2026-09-21", distanceM: 5000, minutes: 25 },
      { week: "2026-09-28", distanceM: 0, minutes: 0 },
      { week: "2026-10-05", distanceM: 30000, minutes: 170 },
    ]);
    expect(longestPerWeek(ws, "run")).toEqual([{ week: "2026-09-21", distanceM: 5000 }, { week: "2026-10-05", distanceM: 20000 }]);
  });
  it("sport all includes everything; ride matches cycling", () => {
    expect(weeklyVolume(ws, "ride")).toEqual([{ week: "2026-10-05", distanceM: 40000, minutes: 60 }]);
    expect(weeklyVolume(ws, "all").reduce((a, r) => a + r.distanceM, 0)).toBe(75000);
  });
  it("zero-fills across a given range including a trailing empty week", () => {
    const r = weeklyVolume(ws, "run", "UTC", { from: "2026-09-14", to: "2026-10-14" });
    expect(r.map((x) => x.week)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(r[4]).toEqual({ week: "2026-10-12", distanceM: 0, minutes: 0 });
    expect(longestPerWeek(ws, "run", "UTC", { from: "2026-09-14", to: "2026-10-14" })).toHaveLength(5);
  });
  it("assigns weeks by local day", () => {
    const late = [w("Run", "2026-10-04T22:30:00Z", { distanceM: 1000 })]; // Sunday UTC, Monday 00:30 in Prague
    expect(weeklyVolume(late, "run")[0]!.week).toBe("2026-09-28");
    expect(weeklyVolume(late, "run", "Europe/Prague")[0]!.week).toBe("2026-10-05");
  });
  it("is empty-safe and tolerates missing distance", () => {
    expect(weeklyVolume([], "run")).toEqual([]);
    expect(longestPerWeek([], "run")).toEqual([]);
    expect(weeklyVolume([w("Run", "2026-10-05T06:00:00Z")], "run")).toEqual([{ week: "2026-10-05", distanceM: 0, minutes: 60 }]);
  });
});

describe("calendarGrid", () => {
  it("returns 84 Monday-aligned days with summed minutes", () => {
    const g = calendarGrid([w("Run", "2026-10-07T06:00:00Z"), w("Yoga", "2026-10-07T18:00:00Z", { durationMin: 30 })], "2026-10-07");
    expect(g).toHaveLength(84);
    expect(g[0]!.date).toBe("2026-07-20"); // Monday, 11 weeks before this week's Monday
    expect(g.find((d) => d.date === "2026-10-07")!.minutes).toBe(90);
  });
  it("uses the local day in the given time zone", () => {
    const ws = [w("Run", "2026-10-06T22:30:00Z")]; // 00:30 on the 7th in Prague (CEST)
    expect(calendarGrid(ws, "2026-10-07").find((d) => d.date === "2026-10-06")!.minutes).toBe(60);
    const g = calendarGrid(ws, "2026-10-07", "Europe/Prague");
    expect(g.find((d) => d.date === "2026-10-07")!.minutes).toBe(60);
    expect(g.find((d) => d.date === "2026-10-06")!.minutes).toBe(0);
    expect(calendarGrid(ws, "2026-10-07", "Not/AZone")).toHaveLength(84);
  });
  it("is zero-filled for no workouts", () => {
    expect(calendarGrid([], "2026-10-07").every((d) => d.minutes === 0)).toBe(true);
  });
  it("is stable on a Sunday", () => {
    expect(calendarGrid([], "2026-10-11")[0]!.date).toBe("2026-07-20");
  });
});

describe("energyBalance", () => {
  it("is intake minus total expenditure on days with both", () => {
    expect(energyBalance({ "2026-10-01": 2000, "2026-10-02": 1800 }, { "2026-10-01": 2500, "2026-10-03": 2400 })).toEqual([{ date: "2026-10-01", balance: -500 }]);
  });
  it("is empty-safe", () => {
    expect(energyBalance({}, {})).toEqual([]);
  });
  it("keeps zero intake days", () => {
    expect(energyBalance({ "2026-10-01": 0 }, { "2026-10-01": 2000 })).toEqual([{ date: "2026-10-01", balance: -2000 }]);
  });
});

const night = (start: string, end: string, stageMinutes: Record<string, number> = {}) => ({ start, end, durationMin: Math.round((Date.parse(end) - Date.parse(start)) / 60000), stageMinutes });

describe("sleepStages", () => {
  it("buckets by wake date and counts unknown as light", () => {
    const r = sleepStages([night("2026-10-05T22:00:00Z", "2026-10-06T06:00:00Z", { deep: 60, rem: 90, light: 300, awake: 20, unknown: 10 })]);
    expect(r).toEqual([{ date: "2026-10-06", deep: 60, rem: 90, light: 310, awake: 20 }]);
  });
  it("is empty-safe", () => expect(sleepStages([])).toEqual([]));
  it("sums two sessions on the same wake date", () => {
    const r = sleepStages([night("2026-10-05T22:00:00Z", "2026-10-06T06:00:00Z", { deep: 60 }), night("2026-10-06T13:00:00Z", "2026-10-06T14:00:00Z", { light: 40 })]);
    expect(r).toEqual([{ date: "2026-10-06", deep: 60, rem: 0, light: 40, awake: 0 }]);
  });
});

describe("sleepSchedule / regularity", () => {
  it("expresses bed and wake in hours since 18:00 of the bed date", () => {
    const r = sleepSchedule([night("2026-10-05T23:30:00Z", "2026-10-06T07:00:00Z")]);
    expect(r).toEqual([{ date: "2026-10-06", bed: 5.5, wake: 13 }]);
  });
  it("reads bed and wake on the local clock in summer and winter", () => {
    expect(sleepSchedule([night("2026-10-05T20:30:00Z", "2026-10-06T04:30:00Z")], "Europe/Prague")).toEqual([{ date: "2026-10-06", bed: 4.5, wake: 12.5 }]);
    expect(sleepSchedule([night("2026-12-01T21:30:00Z", "2026-12-02T05:30:00Z")], "Europe/Prague")).toEqual([{ date: "2026-12-02", bed: 4.5, wake: 12.5 }]);
    expect(sleepStages([night("2026-10-05T20:30:00Z", "2026-10-06T22:30:00Z", { deep: 1 })], "Europe/Prague")[0]!.date).toBe("2026-10-07");
  });
  it("treats after-midnight bedtimes as the previous evening's", () => {
    expect(sleepSchedule([night("2026-10-06T01:00:00Z", "2026-10-06T08:00:00Z")])[0]).toMatchObject({ bed: 7, wake: 14 });
  });
  it("regularity is SD of midpoints in minutes, null under 3 nights", () => {
    expect(regularity([])).toBeNull();
    expect(regularity([{ bed: 5, wake: 13 }, { bed: 5, wake: 13 }])).toBeNull();
    expect(regularity([{ bed: 5, wake: 13 }, { bed: 5, wake: 13 }, { bed: 5, wake: 13 }])).toBe(0);
    const sd = regularity([{ bed: 4, wake: 12 }, { bed: 5, wake: 13 }, { bed: 6, wake: 14 }]);
    expect(sd).toBeCloseTo(Math.sqrt(2 / 3) * 60, 0);
  });
});

describe("anomalies", () => {
  const daily = { rhr: { summary: { deviationPct: -12.5 } }, hrv: { summary: { deviationPct: 30 } }, steps: { summary: { deviationPct: 2 } }, x: { summary: { deviationPct: null } } };
  it("keeps metrics beyond the threshold, largest first", () => {
    expect(anomalies(daily, 10)).toEqual([{ metric: "hrv", deviationPct: 30 }, { metric: "rhr", deviationPct: -12.5 }]);
  });
  it("is empty-safe", () => expect(anomalies({}, 10)).toEqual([]));
  it("caps at 6", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`m${i}`, { summary: { deviationPct: 20 + i } }]));
    expect(anomalies(many, 10)).toHaveLength(6);
  });
});

const lift = (start: string, sets: object[]) => w("Strength", start, { sets });
describe("liftSeries / personalRecords", () => {
  const ws = [
    lift("2026-10-01T10:00:00Z", [{ exercise: "bench_press", reps: 5, weightKg: 100 }, { exercise: "bench_press", reps: 8, weightKg: 80 }, { exercise: "squat", reps: 1, weightKg: 150 }]),
    lift("2026-10-05T10:00:00Z", [{ exercise: "bench_press", reps: 3, weightKg: 110 }]),
  ];
  it("matches a display-name query against snake_case ingest data and gives the best e1RM per day", () => {
    const s = liftSeries(ws, "Bench Press");
    expect(s.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(s[0]!.e1rm).toBeCloseTo(116.67, 1);
    expect(s[1]!.e1rm).toBeCloseTo(121, 1);
  });
  it("ranks personal records with humanised names, top 5", () => {
    const pr = personalRecords(ws);
    expect(pr[0]).toMatchObject({ exercise: "squat", e1rm: 150, date: "2026-10-01" });
    expect(pr[1]!.exercise).toBe("bench press");
    expect(pr).toHaveLength(2);
  });
  it("is empty-safe and skips sets without weight or reps", () => {
    expect(liftSeries([], "x")).toEqual([]);
    expect(personalRecords([])).toEqual([]);
    expect(liftSeries([lift("2026-10-01T10:00:00Z", [{ exercise: "plank", durationS: 60 }])], "Plank")).toEqual([]);
  });
  it("uses the local day", () => {
    const one = [lift("2026-10-06T22:30:00Z", [{ exercise: "squat", reps: 1, weightKg: 100 }])];
    expect(liftSeries(one, "Squat", "Europe/Prague")[0]!.date).toBe("2026-10-07");
  });
});

describe("muscleVolume", () => {
  const ws = [
    lift("2026-10-05T10:00:00Z", [{ exercise: "Bench", reps: 5, muscle: "chest" }, { exercise: "Bench", reps: 5, muscle: "chest" }, { exercise: "Mystery", reps: 5 }]),
    lift("2026-10-12T10:00:00Z", [{ exercise: "Row", reps: 5, muscle: "back" }, { exercise: "Bench", reps: 5, muscle: "chest" }]),
  ];
  it("averages sets per week over the given weeks, grouping unknown muscles as other", () => {
    expect(muscleVolume(ws, 2)).toEqual([{ muscle: "chest", sets: 1.5 }, { muscle: "back", sets: 0.5 }, { muscle: "other", sets: 0.5 }]);
  });
  it("is empty-safe", () => expect(muscleVolume([], 4)).toEqual([]));
  it("ignores workouts without sets and never divides by less than one week", () => {
    expect(muscleVolume([w("Run", "2026-10-05T10:00:00Z")], 4)).toEqual([]);
    expect(muscleVolume(ws, 0)).toEqual([{ muscle: "chest", sets: 3 }, { muscle: "back", sets: 1 }, { muscle: "other", sets: 1 }]);
  });
});

describe("swimStats", () => {
  it("computes pace per 100 m and SWOLF", () => {
    const r = swimStats([w("Pool swim", "2026-10-01T06:00:00Z", { durationMin: 30, distanceM: 1500, poolLengthM: 25, strokes: 1200 })]);
    // 60 lengths: 1800s/60 = 30s, 1200/60 = 20 strokes
    expect(r).toEqual([{ date: "2026-10-01", pacePer100s: 120, swolf: 50 }]);
  });
  it("is empty-safe", () => expect(swimStats([])).toEqual([]));
  it("treats zero strokes as missing", () => {
    expect(swimStats([w("Swim", "2026-10-01T06:00:00Z", { durationMin: 30, distanceM: 1500, poolLengthM: 25, strokes: 0 })])[0]!.swolf).toBeNull();
  });
  it("has null swolf without pool length or strokes and skips zero distance", () => {
    const r = swimStats([w("Open water swim", "2026-10-01T06:00:00Z", { distanceM: 1000, durationMin: 20 }), w("Swim", "2026-10-02T06:00:00Z", { distanceM: 0 })]);
    expect(r).toEqual([{ date: "2026-10-01", pacePer100s: 120, swolf: null }]);
  });
});

describe("helpers", () => {
  it("rangeOf spans whole local days, optionally reaching past today", () => {
    expect(rangeOf(7, "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(rangeOf(7, "2026-10-07", 1)).toEqual({ from: "2026-10-01", to: "2026-10-08" });
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("signed uses a true minus and no sign for zero", () => {
    expect([signed(3), signed(-3), signed(0), signed(-0.04, 1), signed(1.25, 1)]).toEqual(["+3", "−3", "0", "0.0", "+1.3"]);
  });
});

describe("rollingBand", () => {
  const day = (i: number) => addDays("2026-09-01", i);
  it("is mean ± SD of the prior window, null until enough readings", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ date: day(i), value: i % 2 ? 60 : 40 }));
    const band = rollingBand(rows, 28, 14);
    expect(band[13]).toMatchObject({ low: null, high: null });
    expect(band[14]).toMatchObject({ low: 40, high: 60 });
  });
  it("follows a shifting baseline and ignores days outside the window", () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => ({ date: day(i), value: 40 })), ...Array.from({ length: 30 }, (_, i) => ({ date: day(30 + i), value: 70 }))];
    const band = rollingBand(rows, 28, 14);
    expect(band[29]).toMatchObject({ low: 40, high: 40 });
    expect(band[59]).toMatchObject({ low: 70, high: 70 });
  });
});
