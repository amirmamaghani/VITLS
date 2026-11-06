import { ConflictException } from "@nestjs/common";
import { inArray } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { dashboardRevisions, dashboards } from "../db/schema";
import { DashboardStore } from "./dashboard.store";

type DashboardConfig = import("@vitls/dashboard", { with: { "resolution-mode": "import" } }).DashboardConfig;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const EMPTY: DashboardConfig = { version: 1, widgets: [] };
const BODY: DashboardConfig = { version: 1, widgets: [{ id: "w1", kind: "section", title: "Body" }] };
const RECOVERY: DashboardConfig = { version: 1, widgets: [{ id: "w2", kind: "section", title: "Recovery" }] };

describe("DashboardStore", () => {
  const db = new DbService();
  const store = new DashboardStore(db);
  const amy = "dash-amy@t.co";
  const bob = "dash-bob@t.co";
  const id = store.defaultDashboardId(amy);

  afterAll(async () => {
    await db.db.delete(dashboardRevisions).where(inArray(dashboardRevisions.ownerEmail, [amy, bob]));
    await db.db.delete(dashboards).where(inArray(dashboards.ownerEmail, [amy, bob]));
  });

  it("writes a new board, reads it back, and isolates it from other owners", async () => {
    const written = await store.write({ id, kind: "health", title: "Health", config: EMPTY, ownerEmail: amy });
    expect(written.config).toEqual(EMPTY);

    expect(await store.get(id, amy)).toMatchObject({ id, title: "Health", ownerEmail: amy });
    expect(await store.get(id, bob)).toBeNull(); // cross-owner id must not leak
  });

  it("snapshots the previous version on each save and restores it", async () => {
    const before = (await store.listRevisions(id, amy)).length;

    const second = await store.write({ id, kind: "health", title: "Health", config: BODY, ownerEmail: amy });
    expect(second.config).toEqual(BODY);

    const revisions = await store.listRevisions(id, amy);
    expect(revisions.length).toBe(before + 1);
    expect(revisions[0]!.config).toEqual(EMPTY); // the version this save replaced

    const restored = await store.restore(id, revisions[0]!.id, amy);
    expect(restored!.config).toEqual(EMPTY);
    expect((await store.get(id, amy))!.config).toEqual(EMPTY);

    expect(await store.restore(id, "dashboard-revision-missing", amy)).toBeNull();
  });

  it("rejects a stale optimistic-lock write and persists nothing (no update, no revision)", async () => {
    const current = (await store.get(id, amy))!;
    const revisionsBefore = (await store.listRevisions(id, amy)).length;

    await expect(
      store.write({ id, kind: "health", title: "Stale", config: RECOVERY, ownerEmail: amy, expectedUpdatedAt: "1999-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(ConflictException);

    const after = (await store.get(id, amy))!;
    expect(after.updatedAt).toBe(current.updatedAt); // untouched
    expect(after.config).toEqual(current.config);
    expect((await store.listRevisions(id, amy)).length).toBe(revisionsBefore); // no revision written
  });

  it("refuses to archive the owner's only active dashboard", async () => {
    await expect(store.archive(id, amy)).rejects.toBeInstanceOf(ConflictException);

    // With a second active board, archiving the first succeeds.
    const second = "dashboard-amy-second";
    await store.write({ id: second, kind: "health", title: "Second", config: EMPTY, ownerEmail: amy });
    const archived = await store.archive(id, amy);
    expect(archived.archivedAt).not.toBeNull();
    expect((await store.list(amy)).map((d) => d.id)).toEqual([second]); // active list excludes the archived one
  });
});
