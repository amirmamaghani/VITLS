import { describe, expect, it } from "vitest";

import { dashboardIdFromPath, navigationStateForPath, pathForCommand } from "./use-navigation-state";

describe("navigation state", () => {
  it("reads the dashboard id from the route", () => {
    expect(dashboardIdFromPath("/dashboard/dashboard-abc")).toBe("dashboard-abc");
    expect(dashboardIdFromPath("/dashboard/dashboard-abc/")).toBe("dashboard-abc");
    expect(dashboardIdFromPath("/dashboard")).toBeNull();
    expect(dashboardIdFromPath("/settings")).toBeNull();
  });

  it("describes a dashboard route for the agent", () => {
    expect(navigationStateForPath("/dashboard/dashboard-abc")).toEqual({ view: "dashboard", path: "/dashboard/dashboard-abc", dashboardId: "dashboard-abc" });
    expect(navigationStateForPath("/settings/agent")).toEqual({ view: "agent", path: "/settings/agent" });
    expect(navigationStateForPath("/data")).toEqual({ view: "data", path: "/data" });
    expect(navigationStateForPath("/plans")).toEqual({ view: "plans", path: "/plans" });
  });

  it("maps navigate commands to paths", () => {
    expect(pathForCommand({ view: "dashboard", dashboardId: "dashboard-abc" })).toBe("/dashboard/dashboard-abc");
    expect(pathForCommand({ view: "dashboard" })).toBe("/home");
    expect(pathForCommand({ view: "chat" })).toBe("/home");
    expect(pathForCommand({ view: "settings" })).toBe("/settings");
    expect(pathForCommand({ view: "data" })).toBe("/data");
    expect(pathForCommand({ view: "plans" })).toBe("/plans");
  });
});
