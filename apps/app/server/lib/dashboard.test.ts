import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import archiveDashboard from "../../actions/archive-dashboard";
import createDashboard from "../../actions/create-dashboard";
import getDashboard from "../../actions/get-dashboard";
import listRevisions from "../../actions/list-dashboard-revisions";
import listDashboards from "../../actions/list-dashboards";
import restoreRevision from "../../actions/restore-dashboard-revision";
import saveDashboard from "../../actions/save-dashboard";
import { dashboardConfigSchema } from "../../shared/dashboard";
import { getDb, schema } from "../db";
import { setupTestDb } from "../test/db";

const jan = { userEmail: "jan@example.com", orgId: "org_jan", caller: "tool" as const };
const eva = { userEmail: "eva@example.com", orgId: "org_eva", caller: "tool" as const };
const weight = { id: "w", kind: "metric", metric: "weight", view: "line", range: "30d" } as const;

describe("dashboard actions", () => {
  beforeAll(setupTestDb);

  it("the first dashboard always exists", async () => {
    const boards = await listDashboards.run({}, jan);
    expect(boards).toHaveLength(1);
    expect(boards[0]!.title).toBe("Dashboard");
    expect((await getDashboard.run({ dashboardId: boards[0]!.id }, jan)).config.widgets).toEqual([]);
    expect(await listDashboards.run({}, jan)).toHaveLength(1);
  });

  it("saves and keeps revisions for undo", async () => {
    const [board] = await listDashboards.run({}, jan);
    const dashboardId = board!.id;
    const first = await saveDashboard.run({ dashboardId, title: "Dashboard", config: dashboardConfigSchema.parse({ widgets: [weight] }) }, jan);
    await saveDashboard.run(
      { dashboardId, title: "Dashboard", config: dashboardConfigSchema.parse({ widgets: [weight, { id: "s", kind: "sleep", range: "7d" }] }), expectedUpdatedAt: first.updatedAt },
      jan,
    );
    expect((await getDashboard.run({ dashboardId }, jan)).config.widgets).toHaveLength(2);

    const revisions = await listRevisions.run({ dashboardId }, jan);
    await restoreRevision.run({ dashboardId, revisionId: revisions[0]!.id }, jan);
    expect((await getDashboard.run({ dashboardId }, jan)).config.widgets.map((w) => w.id)).toEqual(["w"]);
  });

  it("rejects a stale save", async () => {
    const [board] = await listDashboards.run({}, jan);
    await expect(
      saveDashboard.run({ dashboardId: board!.id, title: "Dashboard", config: dashboardConfigSchema.parse({ widgets: [] }), expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }, jan),
    ).rejects.toThrow();
  });

  it("creates a second dashboard and archives it, never the last one", async () => {
    const marathon = await createDashboard.run({ title: "Marathon" }, jan);
    expect((await listDashboards.run({}, jan)).map((b: { title: string }) => b.title).sort()).toEqual(["Dashboard", "Marathon"]);

    await archiveDashboard.run({ dashboardId: marathon.id }, jan);
    const remaining = await listDashboards.run({}, jan);
    expect(remaining.map((b: { title: string }) => b.title)).toEqual(["Dashboard"]);
    await expect(getDashboard.run({ dashboardId: marathon.id }, jan)).rejects.toThrow(/not found/i);

    await expect(archiveDashboard.run({ dashboardId: remaining[0]!.id }, jan)).rejects.toThrow(/last dashboard/i);
  });

  it("keeps dashboards per user", async () => {
    const [jans] = await listDashboards.run({}, jan);
    const [evas] = await listDashboards.run({}, eva);
    expect(evas!.id).not.toBe(jans!.id);
    await expect(getDashboard.run({ dashboardId: jans!.id }, eva)).rejects.toThrow(/not found/i);
    await expect(archiveDashboard.run({ dashboardId: jans!.id }, eva)).rejects.toThrow(/not found/i);
    await expect(
      saveDashboard.run({ dashboardId: jans!.id, title: "Hijack", config: dashboardConfigSchema.parse({ widgets: [] }) }, eva),
    ).rejects.toThrow(/not found/i);
  });

  it("requires a dashboardId", () => {
    expect(getDashboard.tool.parameters?.required).toContain("dashboardId");
    expect(saveDashboard.tool.parameters?.required).toContain("dashboardId");
    expect(archiveDashboard.tool.parameters?.required).toContain("dashboardId");
  });

  it("archives with the caller's email in any letter case", async () => {
    const Jan = { ...jan, userEmail: "Jan@Example.com" };
    const cut = await createDashboard.run({ title: "Cut" }, Jan);
    await archiveDashboard.run({ dashboardId: cut.id }, Jan);
    expect((await listDashboards.run({}, jan)).map((b: { title: string }) => b.title)).not.toContain("Cut");
  });

  it("never leaves the owner without an active dashboard, even under concurrent archives", async () => {
    const race = await createDashboard.run({ title: "Race" }, jan);
    const other = (await listDashboards.run({}, jan)).find((b: { id: string }) => b.id !== race.id)!;
    const results = await Promise.allSettled([
      archiveDashboard.run({ dashboardId: other.id }, jan),
      archiveDashboard.run({ dashboardId: race.id }, jan),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await listDashboards.run({}, jan)).toHaveLength(1);
  });

  it("revives the default dashboard when every dashboard was archived", async () => {
    await getDb().update(schema.dashboards).set({ archivedAt: new Date().toISOString() }).where(eq(schema.dashboards.ownerEmail, jan.userEmail));
    const boards = await listDashboards.run({}, jan);
    expect(boards).toHaveLength(1);
    expect((await getDashboard.run({ dashboardId: boards[0]!.id }, jan)).config.widgets).toBeDefined();
  });

  it("validates widgets", () => {
    expect(dashboardConfigSchema.safeParse({ widgets: [{ ...weight, metric: "heart_rate" }] }).success).toBe(false);
    expect(dashboardConfigSchema.safeParse({ widgets: [weight, weight] }).success).toBe(false);
  });
});
