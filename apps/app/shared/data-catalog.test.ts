import { describe, expect, it } from "vitest";

import { toCsv } from "../app/lib/export";
import { defaultWidget, groupOf, SECTION_WIDGETS } from "./data-catalog";

describe("data catalog", () => {
  it("groups metrics by theme", () => {
    expect(groupOf("steps")).toBe("activity");
    expect(groupOf("resting_hr")).toBe("recovery");
    expect(groupOf("sleep_duration")).toBe("recovery");
    expect(groupOf("weight")).toBe("body");
    expect(groupOf("waist")).toBe("body");
    expect(groupOf("intake_protein")).toBe("nutrition");
    expect(groupOf("heart_rate")).toBe("intraday");
  });

  it("gives every metric a default widget the dashboard schema accepts", () => {
    expect(defaultWidget("steps")).toMatchObject({ kind: "metric", metric: "steps", view: "line", range: "90d" });
    expect(defaultWidget("weight")).toMatchObject({ kind: "metric", metric: "weight", view: "trend", range: "90d" });
    expect(SECTION_WIDGETS.sleep).toMatchObject({ kind: "sleep", view: "duration" });
    expect(SECTION_WIDGETS.workouts).toMatchObject({ kind: "workouts" });
    expect(SECTION_WIDGETS.meals).toMatchObject({ kind: "meals" });
  });

  it("escapes CSV cells", () => {
    expect(toCsv([{ a: 1, b: 'x,"y"' }, { a: 2, c: null }])).toBe('a,b,c\n1,"x,""y""",\n2,,');
  });
});
