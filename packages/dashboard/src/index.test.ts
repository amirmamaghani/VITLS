import { describe, expect, it } from "vitest";
import { dashboardConfigSchema } from "./index";

const section = (id: string) => ({ id, kind: "section", title: "T" });

describe("dashboardConfigSchema", () => {
  it("accepts a minimal config", () => {
    expect(dashboardConfigSchema.parse({ version: 1, widgets: [section("s")] }).widgets).toHaveLength(1);
  });
  it("rejects more than 20 widgets", () => {
    const widgets = Array.from({ length: 21 }, (_, i) => section(`s${i}`));
    expect(() => dashboardConfigSchema.parse({ version: 1, widgets })).toThrow();
  });
  it("rejects an unknown kind", () => {
    expect(() => dashboardConfigSchema.parse({ version: 1, widgets: [{ id: "x", kind: "nope" }] })).toThrow();
  });
});
