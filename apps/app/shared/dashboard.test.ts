import { describe, expect, it } from "vitest";

import { dashboardConfigSchema, groupSections, ringProgress, WIDGET_CATALOG, widgetSchema } from "./dashboard";

describe("ringProgress", () => {
  it("reads 0–100 scores without a target", () => {
    expect(ringProgress({ unit: "score", latest: 78 })).toEqual({ fraction: 0.78, pct: 78 });
  });

  it("measures against a target", () => {
    expect(ringProgress({ unit: "g", latest: 142, target: 175 })).toEqual({ fraction: 142 / 175, pct: 81 });
  });

  it("caps the arc at a full circle but keeps the real percentage", () => {
    expect(ringProgress({ unit: "count", latest: 11200, target: 10000 })).toEqual({ fraction: 1, pct: 112 });
  });

  it("tracks the way from start to target in either direction", () => {
    expect(ringProgress({ unit: "kg", latest: 84.4, start: 88, target: 78 })?.pct).toBe(36);
    expect(ringProgress({ unit: "kg", latest: 72, start: 70, target: 75 })?.pct).toBe(40);
    expect(ringProgress({ unit: "kg", latest: 89, start: 88, target: 78 })).toEqual({ fraction: 0, pct: -10 });
  });

  it("has no ring without a scale or target", () => {
    expect(ringProgress({ unit: "kg", latest: 87 })).toBeNull();
    expect(ringProgress({ unit: "score", latest: null })).toBeNull();
  });
});

describe("widget schema", () => {
  it("accepts ring metrics with a target and the macros widget", () => {
    expect(widgetSchema.parse({ kind: "metric", metric: "weight", view: "ring", start: 88, target: 78 })).toMatchObject({ view: "ring", target: 78 });
    expect(widgetSchema.parse({ kind: "macros" })).toMatchObject({ kind: "macros" });
  });

  it("parses every catalog kind and view", () => {
    const ok: object[] = [
      ...["number", "line", "bar", "ring", "trend", "band", "rate"].map((view) => ({ kind: "metric", metric: "weight", view })),
      { kind: "metric", metric: "weight", view: "line", compare: "resting_hr" },
      { kind: "readout" }, { kind: "water-vs-fat" }, { kind: "readiness" },
      { kind: "streak", habit: "weigh-in" }, { kind: "streak", habit: "workout" }, { kind: "streak", habit: "log-food" },
      { kind: "streak", habit: "metric", metric: "steps", min: 8000 }, { kind: "streak", habit: "metric", metric: "weight", max: 85 },
      { kind: "milestone", label: "Cut started", since: "2026-09-01" },
      { kind: "anomalies" }, { kind: "anomalies", threshold: 15 },
      { kind: "circumferences" }, { kind: "energy-balance" }, { kind: "meals" },
      { kind: "sleep", view: "stages" }, { kind: "sleep-schedule" },
      ...["run", "ride", "swim", "all"].map((sport) => ({ kind: "volume", sport })),
      { kind: "zones" }, { kind: "long-session", sport: "run" }, { kind: "swim" },
      { kind: "lift", exercise: "Bench Press" }, { kind: "muscle-volume" }, { kind: "prs" }, { kind: "calendar" }, { kind: "tdee" },
    ];
    for (const w of ok) expect(() => widgetSchema.parse(w), JSON.stringify(w)).not.toThrow();
    expect(widgetSchema.parse({ kind: "anomalies" })).toMatchObject({ threshold: 10 });
    expect(widgetSchema.parse({ kind: "sleep" })).toMatchObject({ view: "duration" });
  });

  it("offers the same ranges everywhere, a year included; circumferences default to 90 days", () => {
    expect(widgetSchema.parse({ kind: "metric", metric: "weight", range: "1y" })).toMatchObject({ range: "1y" });
    expect(widgetSchema.parse({ kind: "tdee", range: "1y" })).toMatchObject({ range: "1y" });
    expect(widgetSchema.parse({ kind: "circumferences" })).toMatchObject({ range: "90d" });
    expect(widgetSchema.safeParse({ kind: "metric", metric: "weight", range: "120d" }).success).toBe(false);
  });

  it("rejects incomplete or out-of-range widgets", () => {
    for (const bad of [
      { kind: "streak", habit: "metric" },
      { kind: "streak", habit: "metric", metric: "steps" },
      { kind: "streak", habit: "metric", min: 1 },
      { kind: "milestone", label: "x", since: "yesterday" },
      { kind: "milestone", label: "x", since: "2026-02-30" },
      { kind: "streak", habit: "metric", metric: "steps", min: 9000, max: 5000 },
      { kind: "metric", metric: "weight", compare: "weight" },
      { kind: "anomalies", threshold: 80 },
      { kind: "long-session", sport: "all" },
      { kind: "lift", exercise: "" },
    ]) expect(widgetSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("WIDGET_CATALOG", () => {
  it("mentions every widget kind", () => {
    const kinds = widgetSchema.options.map((o) => o.shape.kind.value);
    for (const kind of kinds) expect(WIDGET_CATALOG, kind).toMatch(new RegExp(`(^|[\\s(-])${kind}\\b`, "m"));
  });
});

describe("dashboard sections", () => {
  const weight = { id: "w", kind: "metric", metric: "weight" } as const;
  const sleep = { id: "s", kind: "sleep" } as const;

  it("accepts section headings between widgets, but not as a chat widget", () => {
    const config = dashboardConfigSchema.parse({ widgets: [{ kind: "section", title: "Body" }, weight] });
    expect(config.widgets[0]).toMatchObject({ kind: "section", title: "Body" });
    expect(dashboardConfigSchema.safeParse({ widgets: [{ kind: "section", title: "" }] }).success).toBe(false);
    expect(widgetSchema.safeParse({ kind: "section", title: "Body" }).success).toBe(false);
    expect(WIDGET_CATALOG).toMatch(/\bsection\b/);
  });

  it("allows up to 20 items", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ id: `x${i}`, kind: "section", title: `S${i}` }));
    expect(dashboardConfigSchema.safeParse({ widgets: items.slice(0, 20) }).success).toBe(true);
    expect(dashboardConfigSchema.safeParse({ widgets: items }).success).toBe(false);
  });

  it("groups widgets under the preceding section heading", () => {
    const { widgets } = dashboardConfigSchema.parse({
      widgets: [weight, { id: "a", kind: "section", title: "Recovery" }, sleep, { id: "b", kind: "section", title: "Empty" }],
    });
    expect(groupSections(widgets).map((g) => [g.section?.title ?? null, g.widgets.map((w) => w.id)])).toEqual([
      [null, ["w"]],
      ["Recovery", ["s"]],
      ["Empty", []],
    ]);
    expect(groupSections([])).toEqual([]);
  });
});
