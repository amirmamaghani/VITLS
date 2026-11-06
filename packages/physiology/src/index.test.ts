import { describe, expect, it } from "vitest";

import { ema, estimate1RM, fatChangeCheck, readiness, summarize, vo2maxPercentile, type Point } from "./index";

const series = (values: number[], start = "2026-09-01"): Point[] =>
  values.map((value, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), value }));

describe("ema", () => {
  it("smooths noise and starts at the first value", () => {
    const trend = ema(series([80, 82, 80, 82]), 0.5);
    expect(trend.map((p) => p.value)).toEqual([80, 81, 80.5, 81.25]);
  });

  it("returns an empty series for empty input", () => {
    expect(ema([])).toEqual([]);
  });

  it("forgets the old level across a long gap, so the trend meets a reading taken months later", () => {
    const trend = ema([...series(Array(10).fill(80)), { date: "2026-12-10", value: 90 }]);
    expect(trend.at(-1)!.value).toBeCloseTo(90, 1);
  });

  it("weighs a reading by the days since the previous one", () => {
    const trend = ema([{ date: "2026-09-01", value: 80 }, { date: "2026-09-03", value: 90 }], 0.5);
    // Two days elapsed: 1 - 0.5^2 = 75 % of the way to the new value.
    expect(trend.at(-1)!.value).toBeCloseTo(87.5, 5);
  });
});

describe("summarize", () => {
  it("separates the latest reading from the trend (water/glycogen offset)", () => {
    const s = summarize(series([...Array(20).fill(85), 87]));
    expect(s.latest).toBe(87);
    expect(s.trend).toBeCloseTo(85.3, 1);
    expect(s.offset).toBeCloseTo(1.7, 1);
  });

  it("reports the weekly trend rate", () => {
    const losing = series(Array.from({ length: 30 }, (_, i) => 90 - i * 0.1));
    expect(summarize(losing).ratePerWeek).toBeCloseTo(-0.7, 1);
  });

  it("compares the recent week to the personal baseline", () => {
    const hrv = series([...Array(53).fill(50), ...Array(7).fill(40)]);
    const s = summarize(hrv);
    expect(s.baseline).toBeCloseTo(48.8, 1);
    expect(s.recent).toBe(40);
    expect(s.deviationPct).toBeCloseTo(-18, 0);
  });

  it("builds the baseline from the last 60 calendar days, not the last 60 readings", () => {
    const monthly = Array.from({ length: 24 }, (_, i) => ({ date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 70 + i }));
    const s = summarize(monthly);
    expect(s.baseline).toBe(92.5);
    expect(s.recent).toBe(93);
  });

  it("ignores missing days and unsorted input", () => {
    const s = summarize([
      { date: "2026-09-03", value: 3 },
      { date: "2026-09-01", value: 1 },
    ]);
    expect(s.latest).toBe(3);
    expect(s.days).toBe(2);
  });

  it("returns nulls when there is no data", () => {
    expect(summarize([])).toMatchObject({ latest: null, trend: null, ratePerWeek: null, deviationPct: null });
  });
});

describe("fatChangeCheck", () => {
  it("flags an overnight jump as water, with the energy math", () => {
    const c = fatChangeCheck(2, 1);
    expect(c.kcalRequired).toBe(15_400);
    expect(c.maxPlausibleFatKg).toBeCloseTo(0.2);
    expect(c.plausibleAsFat).toBe(false);
  });

  it("accepts slow changes as plausible fat", () => {
    expect(fatChangeCheck(0.5, 7).plausibleAsFat).toBe(true);
  });
});

describe("summarize sd", () => {
  it("is the population SD of the baseline window", () => {
    expect(summarize(series([2, 4, 4, 4, 5, 5, 7, 9])).sd).toBe(2);
  });
  it("is null without data", () => {
    expect(summarize([]).sd).toBeNull();
  });
});

describe("readiness", () => {
  it("combines HRV, RHR and sleep", () => {
    const r = readiness({
      hrv: { recent: 55, baseline: 50, days: 30 }, // +10 % -> 75
      rhr: { recent: 50, baseline: 50, days: 30 }, // 0 % -> 50
      sleepHours: 8, // 100
    });
    expect(r.score).toBe(75);
    expect(r.verdict).toBe("train");
    expect(r.enoughHistory).toBe(true);
    expect(r.drivers).toEqual([
      { key: "hrv", deltaPct: 10, effect: "up" },
      { key: "rhr", deltaPct: 0, effect: "flat" },
      { key: "sleep", deltaPct: 0, effect: "flat" },
    ]);
  });

  it("works with HRV only and maps verdict bands", () => {
    expect(readiness({ hrv: { recent: 45, baseline: 50, days: 20 } })).toMatchObject({ score: 25, verdict: "rest" });
    expect(readiness({ hrv: { recent: 49, baseline: 50, days: 20 } })).toMatchObject({ score: 45, verdict: "easy" });
  });

  it("platform score overrides the score, drivers remain", () => {
    const r = readiness({ hrv: { recent: 45, baseline: 50, days: 20 }, platformScore: 80 });
    expect(r.score).toBe(80);
    expect(r.verdict).toBe("train");
    expect(r.drivers).toEqual([{ key: "hrv", deltaPct: -10, effect: "down" }]);
  });

  it("flags short history and returns null without components", () => {
    expect(readiness({ hrv: { recent: 50, baseline: 50, days: 3 } }).enoughHistory).toBe(false);
    expect(readiness({ hrv: { recent: null, baseline: null, days: 3 } })).toMatchObject({
      score: null,
      verdict: null,
      drivers: [],
      enoughHistory: false,
    });
  });
});

describe("estimate1RM", () => {
  it("uses Epley", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.67, 2);
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 0)).toBe(100);
  });
  it("caps reps at 12", () => {
    expect(estimate1RM(100, 30)).toBe(estimate1RM(100, 12));
  });
});

describe("vo2maxPercentile", () => {
  it("is sensible for a 35-year-old man at 42", () => {
    const p = vo2maxPercentile(42, 35, "male");
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(75);
  });
  it("is monotonic in vo2max across the full range", () => {
    for (const [age, sex] of [[45, "female"], [25, "male"], [72, "male"], [33, "female"]] as const) {
      let prev = 0;
      for (let i = 100; i <= 900; i++) {
        const p = vo2maxPercentile(i / 10, age, sex);
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
    }
  });
  it("does not drop just above the top or below the bottom table value", () => {
    expect(vo2maxPercentile(38.5, 45, "female")).toBeGreaterThanOrEqual(vo2maxPercentile(38.4, 45, "female"));
    expect(vo2maxPercentile(55.5, 25, "male")).toBeGreaterThanOrEqual(vo2maxPercentile(55.4, 25, "male"));
    expect(vo2maxPercentile(32.0, 25, "male")).toBeLessThanOrEqual(vo2maxPercentile(32.1, 25, "male"));
  });
  it("clamps to 1-99 and handles ages outside the table", () => {
    expect(vo2maxPercentile(5, 35, "male")).toBe(1);
    expect(vo2maxPercentile(95, 35, "male")).toBe(99);
    expect(vo2maxPercentile(40, 15, "male")).toBe(vo2maxPercentile(40, 20, "male"));
    expect(vo2maxPercentile(40, 90, "female")).toBe(vo2maxPercentile(40, 75, "female"));
  });
});
