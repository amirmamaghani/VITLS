# Dashboard-First Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several dashboards per user, each with exactly one coach chat, and no thread management in the app.

**Architecture:** Dashboards stay in the framework's `createDashboardStorage`; the app stops pinning one id per owner and instead lists, creates and archives dashboards through actions. The chat is the toolkit `AgentSidebar` with a `ChatThreadScope` of `{ type: "vitls-dashboard", id }` and `isolateHistoryByScope`, so the framework creates and restores the thread per dashboard. The full-page chat route, the home handoff and the thread list in the left sidebar are deleted.

**Tech Stack:** `@agent-native/core` 0.203.0 (`dashboard-storage`, `application-state`, `client/navigation`), `@agent-native/toolkit` (`AgentSidebar`, `chat-history/ChatHistoryList`), React Router v8 framework mode, vitest (in-memory PGlite via `server/test/db.ts`), Drizzle.

**Spec:** `docs/superpowers/specs/2026-10-10-dashboard-first-chat-design.md`

All paths below are relative to `apps/app` unless they start with `docs/`. Run every command from `apps/app`.

## Global Constraints

- The first dashboard always exists: `list-dashboards` creates the default one (id `dashboardId(owner)`) when the owner has none. No other code may assume "no dashboard".
- The app never calls `createThread`, `archiveThread`, `pinThread`, `renameThread` or `useChatThreads`; the framework owns threads.
- `AgentSidebar` on a dashboard route gets `scope={{ type: "vitls-dashboard", id }}`, `isolateHistoryByScope` and `showTabBar={false}`.
- `app/i18n/catalogs.test.ts` must stay green: `en-US` must keep every key of the installed chat template, and all 12 other locale files mirror `en-US`. Only app-added keys (`chat.guided*`) may be removed. New keys go into all 13 files in the same task; sk/cs by hand.
- Health data stays per owner: every dashboard read or write goes through `ownerAccess(owner)` from `requireOwner(ctx)`.
- No `node_modules` edits; no new abstractions beyond the actions and one sidebar section. Net lines must go down (spec ledger: about −930).
- Commit after each task; `git add` only the files the task names (the working tree contains unrelated changes from other sessions).

## Review Focus

1. A `dashboardId` that belongs to another user: `get-dashboard`, `save-dashboard`, revisions and `archive-dashboard` must fail with 404, never read or write the row. (Test in Task 1.)
2. Archiving the only active dashboard: must be refused with 409 so the invariant "first dashboard always exists" holds without resurrection logic. (Test in Task 1.)
3. Visiting `/dashboard/<unknown id>` in the browser: the page shows the not-found state and the sidebar keeps working; the chat panel has no scope for that id and stays usable. (Manual check in Task 7.)
4. Two dashboards, switching back and forth: each shows its own thread, nothing is created on every switch. (Manual check in Task 7; the framework keys open tabs per scope.)
5. The coach calling `save-dashboard` without `dashboardId`: validation error with a message naming `view-screen`, no fallback to the default dashboard. (Test in Task 1.)

---

### Task 1: Dashboard actions take an id; list, create and archive dashboards

**Files:**
- Modify: `server/db/index.ts:19,28-31`
- Modify: `actions/get-dashboard.ts`, `actions/save-dashboard.ts`, `actions/list-dashboard-revisions.ts`, `actions/restore-dashboard-revision.ts`
- Create: `actions/list-dashboards.ts`, `actions/create-dashboard.ts`, `actions/archive-dashboard.ts`
- Test: `server/lib/dashboard.test.ts`
- Create: `docs/upstream/agent-native-dashboard-storage-no-archive.md`

**Interfaces:**
- Consumes: `dashboardStore` (`get`, `list`, `write`, `listRevisionMetadata`, `restore`), `ownerAccess`, `requireOwner`, `EMPTY_DASHBOARD`, `schema.dashboards`, `getDb`.
- Produces (used by Tasks 3, 4, 6):
  - `list-dashboards` GET `{}` → `{ id: string; title: string; updatedAt: string }[]`, newest-updated first, never empty.
  - `create-dashboard` `{ title: string }` → `DashboardRecord` (`id`, `title`, `config`, `updatedAt`, …).
  - `archive-dashboard` `{ dashboardId: string }` → `{ id: string }`; 409 when it is the last active dashboard; 404 when not owned.
  - `get-dashboard` GET `{ dashboardId: string }` → `DashboardRecord`; 404 when not owned.
  - `save-dashboard` `{ dashboardId, title, config, expectedUpdatedAt? }` → `DashboardRecord`.
  - `list-dashboard-revisions` GET `{ dashboardId }`, `restore-dashboard-revision` `{ dashboardId, revisionId }`.
  - `server/db/index.ts`: `dashboardId(owner)` keeps its signature; its doc comment now says "default dashboard"; `getResourcePath` becomes `({ id }) => \`/dashboard/${id}\``.

- [ ] **Step 1: Rewrite the dashboard action test for the new contract**

Replace the whole of `server/lib/dashboard.test.ts` with:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import archiveDashboard from "../../actions/archive-dashboard";
import createDashboard from "../../actions/create-dashboard";
import getDashboard from "../../actions/get-dashboard";
import listRevisions from "../../actions/list-dashboard-revisions";
import listDashboards from "../../actions/list-dashboards";
import restoreRevision from "../../actions/restore-dashboard-revision";
import saveDashboard from "../../actions/save-dashboard";
import { dashboardConfigSchema } from "../../shared/dashboard";
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
    expect((await listDashboards.run({}, jan)).map((b) => b.title).sort()).toEqual(["Dashboard", "Marathon"]);

    await archiveDashboard.run({ dashboardId: marathon.id }, jan);
    const remaining = await listDashboards.run({}, jan);
    expect(remaining.map((b) => b.title)).toEqual(["Dashboard"]);
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

  it("requires a dashboardId", async () => {
    expect(getDashboard.schema.safeParse({}).success).toBe(false);
    expect(saveDashboard.schema.safeParse({ title: "Dashboard", config: { version: 1, widgets: [] } }).success).toBe(false);
  });

  it("validates widgets", () => {
    expect(dashboardConfigSchema.safeParse({ widgets: [{ ...weight, metric: "heart_rate" }] }).success).toBe(false);
    expect(dashboardConfigSchema.safeParse({ widgets: [weight, weight] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest --run server/lib/dashboard.test.ts`
Expected: FAIL, first on "Failed to resolve import ../../actions/archive-dashboard".

- [ ] **Step 3: Update `server/db/index.ts`**

Change line 19 and the `dashboardId` doc comment:

```ts
  getResourcePath: ({ id }) => `/dashboard/${id}`,
```

```ts
/** The default dashboard, created by list-dashboards when the owner has none (one per user and org, stable id). */
export function dashboardId(owner: { userEmail: string; orgId: string | null }): string {
```

- [ ] **Step 4: Add a shared loader so every action fails the same way on a foreign or archived id**

Create `server/lib/dashboard.ts`:

```ts
import { fail } from "@agent-native/core/action";

import { dashboardStore, ownerAccess } from "../db";
import type { OwnerScope } from "./ingest/devices";

/** The owner's active dashboard by id; 404 for ids the owner cannot see or has archived. */
export async function requireDashboard(dashboardId: string, owner: OwnerScope) {
  const dashboard = await dashboardStore.get(dashboardId, ownerAccess(owner));
  if (!dashboard || dashboard.archivedAt) fail("Dashboard not found", { statusCode: 404, errorCode: "not_found" });
  return dashboard;
}

export const dashboardIdArg = { describe: "Dashboard id from view-screen (navigation.dashboardId) or list-dashboards" };
```

`OwnerScope` is the type `requireOwner` already returns (declared in `server/lib/ingest/devices.ts`).

- [ ] **Step 5: Write `actions/list-dashboards.ts`**

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardId, dashboardStore, ownerAccess } from "../server/db";
import { requireOwner } from "../server/lib/ingest/owner";
import { EMPTY_DASHBOARD } from "../shared/dashboard";

/** The only place that guarantees the first dashboard exists; every other dashboard action assumes it. */
export default defineAction({
  description:
    "List the signed-in user's dashboards ({ id, title, updatedAt }[], most recently updated first). Each dashboard has its own chat with you. Never empty: the default dashboard is created on first call.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const owner = await requireOwner(ctx);
    const access = ownerAccess(owner);
    let boards = await dashboardStore.list(access);
    if (boards.length === 0) {
      await dashboardStore.write({ id: dashboardId(owner), kind: "health", title: "Dashboard", config: EMPTY_DASHBOARD }, access);
      boards = await dashboardStore.list(access);
    }
    return boards.map(({ id, title, updatedAt }: { id: string; title: string; updatedAt: string }) => ({ id, title, updatedAt }));
  },
});
```

- [ ] **Step 6: Write `actions/create-dashboard.ts`**

```ts
import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { requireOwner } from "../server/lib/ingest/owner";
import { EMPTY_DASHBOARD } from "../shared/dashboard";

export default defineAction({
  description:
    "Create an empty dashboard with its own chat (e.g. a separate board for a race or a cut). Returns the dashboard; fill it with save-dashboard. The user can also create one from the sidebar.",
  schema: z.object({ title: z.string().trim().min(1).max(80) }),
  run: async ({ title }, ctx) => {
    const owner = await requireOwner(ctx);
    return dashboardStore.write({ id: `dashboard-${randomUUID()}`, kind: "health", title, config: EMPTY_DASHBOARD }, ownerAccess(owner));
  },
});
```

- [ ] **Step 7: Write `actions/archive-dashboard.ts`**

The store has no archive method (see the upstream note in Step 12), so this sets `archived_at` directly, scoped by owner.

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { dashboardStore, getDb, ownerAccess, schema } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "Archive a dashboard and hide its chat. The last remaining dashboard cannot be archived.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  run: async ({ dashboardId }, ctx) => {
    const owner = await requireOwner(ctx);
    await requireDashboard(dashboardId, owner);
    const active = await dashboardStore.list(ownerAccess(owner));
    if (active.length <= 1) fail("The last dashboard cannot be archived", { statusCode: 409, errorCode: "conflict" });
    // docs/upstream/agent-native-dashboard-storage-no-archive.md: the store reads archived_at but has no writer for it.
    await getDb()
      .update(schema.dashboards)
      .set({ archivedAt: new Date().toISOString() })
      .where(and(eq(schema.dashboards.id, dashboardId), eq(schema.dashboards.ownerEmail, owner.userEmail)));
    return { id: dashboardId };
  },
});
```

- [ ] **Step 8: Rewrite `actions/get-dashboard.ts`**

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Get one of the signed-in user's dashboards: title, widgets and updatedAt. Widgets are { id, kind: metric|sleep|workouts, metric?, view?, range, bucket?, title?, wide? }. Empty until first saved. Read it before save-dashboard.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ dashboardId }, ctx) => requireDashboard(dashboardId, await requireOwner(ctx)),
});
```

- [ ] **Step 9: Update `actions/save-dashboard.ts`**

Replace the schema and `run`:

```ts
  schema: z.object({
    dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe),
    title: z.string().trim().min(1).max(80).default("Dashboard"),
    config: dashboardConfigSchema,
    expectedUpdatedAt: z.string().optional(),
  }),
  run: async ({ dashboardId, title, config, expectedUpdatedAt }, ctx) => {
    const owner = await requireOwner(ctx);
    const current = await requireDashboard(dashboardId, owner);
    // The store's own conditional write (expectedUpdatedAt) needs an affected-row count, which core 0.198–0.201 doesn't
    // read from the postgres.js driver (it returns `count`), so every guarded save failed on Postgres. Check here
    // instead (docs/upstream/agent-native-dashboard-storage-affected-rows.md); one owner per dashboard keeps the
    // read-then-write window harmless.
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      fail("The dashboard changed meanwhile — read it again with get-dashboard and retry.", { statusCode: 409, errorCode: "conflict" });
    }
    return dashboardStore.write({ id: dashboardId, kind: "health", title, config }, ownerAccess(owner));
  },
```

Imports become `import { dashboardStore, ownerAccess } from "../server/db";` and `import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";` (drop `dashboardId`). In the description, change "the signed-in user's whole health dashboard (/dashboard)" to "one whole dashboard (the one the user is looking at: view-screen → navigation.dashboardId)".

- [ ] **Step 10: Update the two revision actions**

`actions/list-dashboard-revisions.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "List earlier versions of a dashboard (each save keeps the one it replaced), newest first.",
  schema: z.object({ dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ dashboardId }, ctx) => {
    const owner = await requireOwner(ctx);
    await requireDashboard(dashboardId, owner);
    return dashboardStore.listRevisionMetadata(dashboardId, ownerAccess(owner));
  },
});
```

`actions/restore-dashboard-revision.ts`:

```ts
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardStore, ownerAccess } from "../server/db";
import { dashboardIdArg, requireDashboard } from "../server/lib/dashboard";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "Restore an earlier version of a dashboard (undo). The current version is kept as a revision.",
  schema: z.object({
    dashboardId: z.string().trim().min(1).max(200).describe(dashboardIdArg.describe),
    revisionId: z.string().trim().min(1).max(200).describe("Revision id from list-dashboard-revisions"),
  }),
  run: async ({ dashboardId, revisionId }, ctx) => {
    const owner = await requireOwner(ctx);
    await requireDashboard(dashboardId, owner);
    const restored = await dashboardStore.restore(dashboardId, revisionId, ownerAccess(owner));
    if (!restored) fail("Dashboard revision was not found", { statusCode: 404, errorCode: "not_found" });
    return restored;
  },
});
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm vitest --run server/lib/dashboard.test.ts`
Expected: PASS, 7 tests. If "the first dashboard always exists" fails on `updatedAt` typing, check what `dashboardStore.list` returns with `console.log` once and adjust only the map in `list-dashboards.ts`.

- [ ] **Step 12: Write the upstream note**

Create `docs/upstream/agent-native-dashboard-storage-no-archive.md`:

```md
# Upstream issue draft: dashboard-storage has no archive writer

**Package:** `@agent-native/core` 0.203.0, `dist/dashboard-storage/store.js`

## Symptom
`createDashboardStorage(...)` reads `archived_at` (`list(ctx, "active" | "archived" | "all")` filters on it and
`DashboardRecord.archivedAt` exposes it) but exposes no method that sets it. An app that lets users archive a
dashboard has to update the table directly.

## Workaround in VITLS
`apps/app/actions/archive-dashboard.ts` runs a Drizzle `update(dashboards).set({ archivedAt })` scoped by owner after
`store.get` confirmed access. Delete it when the store ships `archive(id, ctx)` / `unarchive(id, ctx)`.

## Ask
Add `archive(id, ctx)` and `unarchive(id, ctx)` to the store (editor access, snapshot like `write`) so apps never touch
the table.
```

- [ ] **Step 13: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors in `actions/` or `server/`. Errors in `app/routes/dashboard.tsx` about `get-dashboard` arguments are expected until Task 3 (they are `as never` casts, so there should be none; if the action typing surfaces one, note it and continue).

```bash
git add actions/list-dashboards.ts actions/create-dashboard.ts actions/archive-dashboard.ts actions/get-dashboard.ts actions/save-dashboard.ts actions/list-dashboard-revisions.ts actions/restore-dashboard-revision.ts server/db/index.ts server/lib/dashboard.ts server/lib/dashboard.test.ts ../../docs/upstream/agent-native-dashboard-storage-no-archive.md
git commit -m "feat(app/dashboard): several dashboards per user; list, create and archive actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Navigation state carries the dashboard id instead of a thread id

**Files:**
- Modify: `app/hooks/use-navigation-state.ts`
- Modify: `actions/navigate.ts`
- Test: `app/hooks/use-navigation-state.test.ts` (create)

**Interfaces:**
- Produces: `export function dashboardIdFromPath(pathname: string): string | null` (used by Task 4 for the chat scope) and `NavigationState = { view: string; path?: string; dashboardId?: string }` (read by the coach through `view-screen`).
- `navigate` action accepts `dashboardId` instead of `threadId`; `pathForView("dashboard")` with a `dashboardId` yields `/dashboard/<id>`, without one `/home` (which redirects to the first dashboard, Task 3).

- [ ] **Step 1: Write the failing test**

Create `app/hooks/use-navigation-state.test.ts`:

```ts
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
  });

  it("maps navigate commands to paths", () => {
    expect(pathForCommand({ view: "dashboard", dashboardId: "dashboard-abc" })).toBe("/dashboard/dashboard-abc");
    expect(pathForCommand({ view: "dashboard" })).toBe("/home");
    expect(pathForCommand({ view: "chat" })).toBe("/home");
    expect(pathForCommand({ view: "settings" })).toBe("/settings");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest --run app/hooks/use-navigation-state.test.ts`
Expected: FAIL with "does not provide an export named dashboardIdFromPath".

- [ ] **Step 3: Rewrite `app/hooks/use-navigation-state.ts`**

```ts
import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  dashboardId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname }) => navigationStateForPath(pathname),
    getCommandPath: (command) => routerPath(command.path || pathForCommand(command)),
  });
}

export function navigationStateForPath(pathname: string): NavigationState {
  const dashboardId = dashboardIdFromPath(pathname);
  return { view: viewForPath(pathname), path: appPath(pathname), ...(dashboardId ? { dashboardId } : {}) };
}

/** `/dashboard/:dashboardId` → the id; null elsewhere. */
export function dashboardIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/([^/]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!).trim() || null;
  } catch {
    return null;
  }
}

function viewForPath(pathname: string): string {
  if (pathname.startsWith("/dashboard") || pathname === "/home") return "dashboard";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/settings/agent") || pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/settings") || pathname.startsWith("/team")) return "settings";
  return "dashboard";
}

function pathForView(view?: string): string {
  switch (view) {
    case "database":
      return "/database";
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "agent":
      return "/settings/agent";
    case "settings":
      return "/settings";
    case "team":
      return "/settings/organization";
    default:
      return "/home";
  }
}

export function pathForCommand(command: { view?: string; dashboardId?: string }): string {
  const dashboardId = command.dashboardId?.trim();
  if ((command.view === "dashboard" || !command.view) && dashboardId) return `/dashboard/${encodeURIComponent(dashboardId)}`;
  return pathForView(command.view);
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}
```

- [ ] **Step 4: Update `actions/navigate.ts`**

Replace the `threadId` field and its use:

```ts
    dashboardId: z.string().optional().describe("Dashboard id to open (with view: dashboard)"),
```

```ts
    if (args.dashboardId) nav.dashboardId = args.dashboardId;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest --run app/hooks/use-navigation-state.test.ts`
Expected: PASS, 3 tests. vitest runs in the node environment (`vitest.config.ts`); the hook file only imports functions from `@agent-native/core/client/navigation` and `api-path`, neither touches `window` at module load, so importing it without a DOM is fine. If an import does throw on load, move the three pure functions (`navigationStateForPath`, `dashboardIdFromPath`, `pathForCommand`) plus `viewForPath`/`pathForView`/`routerPath` into `app/lib/navigation-paths.ts` and import them from the hook; the test then imports that file.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/use-navigation-state.ts app/hooks/use-navigation-state.test.ts actions/navigate.ts
git commit -m "feat(app/navigation): application state carries the dashboard id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard route by id; home redirects to the first dashboard

**Files:**
- Create: `app/routes/dashboard.$dashboardId.tsx` (moved from `app/routes/dashboard.tsx`)
- Delete: `app/routes/dashboard.tsx`
- Modify: `app/routes/home.tsx`
- Delete: `app/lib/chat-home-thread.ts`

**Interfaces:**
- Consumes: `list-dashboards`, `get-dashboard { dashboardId }`, `save-dashboard { dashboardId, … }` from Task 1.
- Produces: URL `/dashboard/:dashboardId` as the only dashboard route; `/home` → first dashboard.

- [ ] **Step 1: Move the route file**

```bash
git mv app/routes/dashboard.tsx 'app/routes/dashboard.$dashboardId.tsx'
```

- [ ] **Step 2: Pass the id into every action call**

In `app/routes/dashboard.$dashboardId.tsx`:

Add `useParams` to the React Router import (there is none yet; add the line):

```ts
import { useParams } from "react-router";
```

Replace the start of `DashboardRoute`:

```tsx
export default function DashboardRoute() {
  const { dashboardId = "" } = useParams();
  const query = useActionQuery("get-dashboard", { dashboardId } as never);
  const save = useActionMutation("save-dashboard");
  const dashboard = query.data as Dashboard | undefined;

  const update = (widgets: DashboardConfig["widgets"]) =>
    save.mutate({ dashboardId, title: dashboard!.title, config: { version: 1, widgets }, expectedUpdatedAt: dashboard!.updatedAt } as never);

  if (query.error) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-6 text-sm text-muted-foreground">Dashboard not found.</div>
    );
  }
  if (!dashboard) return <div className="px-6 py-6" aria-busy="true" />;
```

Pass the title into the header so the page says which board it is: change `<DashboardHeader />` to `<DashboardHeader title={dashboard.title} />`, and in `DashboardHeader`:

```tsx
function DashboardHeader({ title }: { title: string }) {
```

and under the date line add the board title before the greeting:

```tsx
        <span className="text-sm text-muted-foreground first-letter:uppercase">
          {title} · {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(timeZone ? { timeZone } : {}) })}
        </span>
```

(replace the existing date `<span>` with this one). Update `meta()` to keep `Dashboard - ${APP_TITLE}`; the title is not available at meta time.

- [ ] **Step 3: Rewrite `app/routes/home.tsx`**

```tsx
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

/** `/home` is the most recently updated dashboard; the first one is created by list-dashboards. */
export default function HomeRoute() {
  const navigate = useNavigate();
  const boards = useActionQuery("list-dashboards", {} as never);
  const first = (boards.data as { id: string }[] | undefined)?.[0];
  useEffect(() => {
    if (first) navigate(`/dashboard/${encodeURIComponent(first.id)}`, { replace: true });
  }, [first, navigate]);
  return <div className="px-6 py-6" aria-busy="true" />;
}
```

- [ ] **Step 4: Delete the handoff helper**

```bash
git rm app/lib/chat-home-thread.ts
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: errors only in `app/components/chat/ChatRouteContent.tsx` (imports `consumeChatHomeThreadId`) and `app/components/layout/*` (handoff props) — both are removed in Task 4. Any other error is a Task 3 bug.

- [ ] **Step 6: Commit**

```bash
git add 'app/routes/dashboard.$dashboardId.tsx' app/routes/home.tsx
git commit -m "feat(app/dashboard): route per dashboard id; home opens the first dashboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git mv` and `git rm` already staged their changes.)

---

### Task 4: One chat per dashboard in the agent panel; the full-page chat goes

**Files:**
- Modify: `app/components/layout/AgentInspector.tsx`
- Modify: `app/components/layout/Layout.tsx`
- Delete: `app/routes/chat.$threadId.tsx`, `app/components/chat/ChatRouteContent.tsx`
- Modify: `app/lib/register-chat-renderers.tsx:10-11` (comment only)
- Modify: `app/global.css` (remove rules only used by the deleted full-page chat, if any)

**Interfaces:**
- Consumes: `dashboardIdFromPath` from Task 2.
- Produces: `AgentInspector({ children })` with no other props; `Layout` without chat-route branches.

- [ ] **Step 1: Rewrite `app/components/layout/AgentInspector.tsx`**

```tsx
import { useT } from "@agent-native/core/client/i18n";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";

import { dashboardIdFromPath } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

/** The coach panel. On a dashboard route the thread is scoped to that dashboard: one chat per dashboard, managed by the framework. */
export function AgentInspector({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const t = useT();
  const dashboardId = dashboardIdFromPath(pathname);
  const scope = useMemo(() => (dashboardId ? { type: "vitls-dashboard", id: dashboardId } : null), [dashboardId]);

  return (
    <AgentSidebar
      position="right"
      storageKey="chat"
      browserTabId={TAB_ID}
      scope={scope}
      isolateHistoryByScope
      showTabBar={false}
      emptyStateText={t("chat.inspectEmptyState")}
      agentPageHref="/settings/agent"
      suggestions={[
        t("chat.inspectSuggestionCapabilities"),
        t("chat.inspectSuggestionHello"),
        t("chat.inspectSuggestionAction"),
      ]}
    >
      {children}
    </AgentSidebar>
  );
}
```

- [ ] **Step 2: Simplify `app/components/layout/Layout.tsx`**

Remove the import of `isAgentChatHomeHandoffActive`, `useAgentChatHomeHandoff`, `useAgentChatHomeHandoffLinks` (lines 3-7), the `Button` import if it becomes unused, and the `APP_TITLE` import if it becomes unused.

Replace `routeOwnsToolbar`:

```ts
function routeOwnsToolbar(pathname: string): boolean {
  return (
    pathname === "/home" ||
    pathname.startsWith("/dashboard") ||
    pathname === "/database" ||
    pathname.startsWith("/extensions")
  );
}
```

Inside `Layout`, delete `isChatRoute`, the three handoff calls (`chatHomeHandoffActive`, `chatHomeHandoffPending`, `useAgentChatHomeHandoffLinks`), and the `useEffect` that listens to `agent-chat:open-thread`.

`glassHeader` becomes `const glassHeader = !ownsToolbar && !settingsOwnsChrome;`.

In `contentFrame`, drop the first `isChatRoute ? (…) :` branch so it reads:

```tsx
      {ownsToolbar ? (
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4 md:hidden">
          …unchanged button…
        </div>
      ) : settingsOwnsChrome ? null : (
        <Suspense fallback={<div className="h-12 shrink-0" />}>
          <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        </Suspense>
      )}
```

At the bottom, replace the `isChatRoute ? (…) : (…)` block with just:

```tsx
        <Suspense fallback={contentFrame}>
          <AgentInspector>{contentFrame}</AgentInspector>
        </Suspense>
```

- [ ] **Step 3: Delete the full-page chat**

```bash
git rm 'app/routes/chat.$threadId.tsx' app/components/chat/ChatRouteContent.tsx
rmdir app/components/chat 2>/dev/null || true
```

In `app/lib/register-chat-renderers.tsx` replace the two comment lines 10-11 with:

```ts
// Same specifier as the toolkit's own AgentKit surface ("…/agentkit-chat/index"): Vite dev treats specifiers as
// separate modules, and a second copy of the toolkit registry would never see this renderer.
```

- [ ] **Step 4: Remove CSS only the full-page chat used**

Run: `rg -n "agentkit-chat|data-agent-chat-canvas|chat-layout-shell" app/global.css`
For each rule found, check with `rg -n "<class or attribute>" app --glob '!global.css' node_modules/@agent-native/toolkit/dist/app/chat/*.js | head -3`. Delete a rule only when neither the app nor the toolkit emits the selector any more. Keep the composer rules from the dark-mode work (`.agentkit-chat .agentkit-composer…`, `.border-input`); the sidebar composer uses them.

- [ ] **Step 5: Typecheck and test**

Run: `pnpm typecheck && pnpm vitest --run`
Expected: both clean. `Sidebar.tsx` still compiles (its thread helpers are removed in Task 5), and `app/lib/sidebar-thread-state.test.ts` still passes until Task 5 deletes it.

- [ ] **Step 6: Commit**

```bash
git add app/components/layout/AgentInspector.tsx app/components/layout/Layout.tsx app/lib/register-chat-renderers.tsx app/global.css
git commit -m "feat(app/chat): the coach panel is scoped to the open dashboard; drop the full-page chat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Left sidebar lists dashboards; command menu and header follow

**Files:**
- Modify: `app/components/layout/Sidebar.tsx` (delete lines 2-7, 11-15, 46, 49-50, 58-442; replace lines 566-585)
- Delete: `app/lib/sidebar-thread-state.ts`, `app/lib/sidebar-thread-state.test.ts`
- Modify: `app/root.tsx:118-141`
- Modify: `app/components/layout/Header.tsx:12-17`
- Modify: `app/global.css` (`.chat-sidebar-thread-*` rules)
- Modify: all 13 files in `app/i18n/*.ts` (not `*.chrome.ts`)

**Interfaces:**
- Consumes: `list-dashboards`, `create-dashboard`, `archive-dashboard`, `save-dashboard` (rename = save with the new title) from Task 1; `dashboardIdFromPath` from Task 2.
- Produces: i18n keys `navigation.dashboards`, `navigation.newDashboard`, `navigation.renameDashboard`, `navigation.archiveDashboard`, `navigation.dashboardOptions` (with `{{title}}`); `chat.guided*` keys removed.

- [ ] **Step 1: Add the i18n keys and remove the guided ones**

In `app/i18n/en-US.ts`, delete the five `guidedTitle`, `guidedDescription`, `guidedSkip`, `guidedContinue`, `guidedSkipMessage` lines in `chat`, and add to `navigation` (alphabetical):

```ts
    archiveDashboard: "Archive dashboard",
    dashboardOptions: "Options for {{title}}",
    dashboards: "Dashboards",
    newDashboard: "New dashboard",
    renameDashboard: "Rename dashboard",
```

Do the same in the other 12 files. Translations:

| file | archiveDashboard | dashboardOptions | dashboards | newDashboard | renameDashboard |
| --- | --- | --- | --- | --- | --- |
| sk-SK | Archivovať dashboard | Možnosti pre {{title}} | Dashboardy | Nový dashboard | Premenovať dashboard |
| cs-CZ | Archivovat dashboard | Možnosti pro {{title}} | Dashboardy | Nový dashboard | Přejmenovat dashboard |
| de-DE | Dashboard archivieren | Optionen für {{title}} | Dashboards | Neues Dashboard | Dashboard umbenennen |
| es-ES | Archivar panel | Opciones de {{title}} | Paneles | Nuevo panel | Renombrar panel |
| fr-FR | Archiver le tableau de bord | Options pour {{title}} | Tableaux de bord | Nouveau tableau de bord | Renommer le tableau de bord |
| pt-BR | Arquivar painel | Opções de {{title}} | Painéis | Novo painel | Renomear painel |
| ja-JP | ダッシュボードをアーカイブ | {{title}} のオプション | ダッシュボード | 新しいダッシュボード | ダッシュボードの名前を変更 |
| ko-KR | 대시보드 보관 | {{title}} 옵션 | 대시보드 | 새 대시보드 | 대시보드 이름 바꾸기 |
| zh-CN | 归档仪表板 | {{title}} 的选项 | 仪表板 | 新建仪表板 | 重命名仪表板 |
| zh-TW | 封存儀表板 | {{title}} 的選項 | 儀表板 | 新增儀表板 | 重新命名儀表板 |
| ar-SA | أرشفة لوحة المعلومات | خيارات {{title}} | لوحات المعلومات | لوحة معلومات جديدة | إعادة تسمية لوحة المعلومات |
| hi-IN | डैशबोर्ड संग्रहित करें | {{title}} के विकल्प | डैशबोर्ड | नया डैशबोर्ड | डैशबोर्ड का नाम बदलें |

Run: `pnpm vitest --run app/i18n/catalogs.test.ts`
Expected: PASS (keys and `{{title}}` placeholders match in all 13 files).

- [ ] **Step 2: Replace the thread section in `Sidebar.tsx` with a dashboards section**

Replace the imports at the top of the file with:

```tsx
import { callAction, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared/AgentNativeIcon";
import { ChatHistoryList } from "@agent-native/toolkit/chat-history/ChatHistoryList";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSun,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { dashboardIdFromPath } from "@/hooks/use-navigation-state";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";
```

Delete everything from `const CHAT_STORAGE_KEY` (line 49) through the end of `ChatThreadsSection` (line 442), keeping `interface SidebarProps`. Insert in its place:

```tsx
type DashboardSummary = { id: string; title: string; updatedAt: string };

/** Each dashboard is one conversation with the coach; the list is the owner's active dashboards, newest first. */
function DashboardsSection({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const t = useT();
  const boards = useActionQuery("list-dashboards", {} as never);
  const create = useActionMutation("create-dashboard");
  const save = useActionMutation("save-dashboard");
  const archive = useActionMutation("archive-dashboard");
  const items = ((boards.data as DashboardSummary[] | undefined) ?? []).map((board) => ({ id: board.id, title: board.title, titleText: board.title }));
  const activeId = dashboardIdFromPath(pathname);
  const open = (id: string) => navigate(`/dashboard/${encodeURIComponent(id)}`);

  const handleNew = async () => {
    const created = (await create.mutateAsync({ title: t("navigation.newDashboard") } as never)) as { id: string };
    open(created.id);
  };
  const handleRename = async (id: string, title: string) => {
    if (!title.trim()) return;
    // Rename is a save with the same widgets: the store keeps title and config together.
    const current = (await callAction("get-dashboard", { dashboardId: id } as never)) as { config: unknown; updatedAt: string };
    await save.mutateAsync({ dashboardId: id, title: title.trim(), config: current.config, expectedUpdatedAt: current.updatedAt } as never);
  };
  const handleArchive = async (id: string) => {
    try {
      await archive.mutateAsync({ dashboardId: id } as never);
      if (id === activeId) navigate("/home");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const newButton = (
    <button
      type="button"
      onClick={() => void handleNew()}
      className={cn(
        "flex items-center text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        collapsed ? "size-10 justify-center rounded-md" : "h-10 w-full gap-3 rounded-lg px-3 text-sm font-medium",
      )}
      aria-label={collapsed ? t("navigation.newDashboard") : undefined}
    >
      <IconPlus className="size-4 shrink-0" strokeWidth={1.8} />
      <span className={collapsed ? "sr-only" : "truncate"}>{t("navigation.newDashboard")}</span>
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{newButton}</TooltipTrigger>
        <TooltipContent side="right">{t("navigation.newDashboard")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-3">{newButton}</div>
      <ChatHistoryList
        sections={[{ id: "dashboards", label: t("navigation.dashboards"), items }]}
        activeId={activeId}
        onSelect={open}
        onRename={(id, title) => void handleRename(id, title)}
        renameMaxLength={80}
        onDelete={(id) => void handleArchive(id)}
        labels={{
          options: (item) => t("navigation.dashboardOptions", { title: item.titleText ?? "" }),
          renameInput: (item) => t("navigation.dashboardOptions", { title: item.titleText ?? "" }),
          rename: t("navigation.renameDashboard"),
          delete: t("navigation.archiveDashboard"),
        }}
        variant="rail"
        emptyLabel={null}
        className="chat-sidebar-history min-h-0 flex-1"
        listClassName="pb-4"
      />
    </div>
  );
}
```

`callAction(actionName, params)` is the core client's one-off action call (`@agent-native/core/client/hooks`, declared in `dist/client/use-action.d.ts`); `useActionMutation("save-dashboard")` refreshes the `list-dashboards` query after the save, so the renamed title shows without extra code.

In the `<nav>` block replace the `Dashboard` link block (the `<div className={collapsed ? "contents" : "px-2 pb-1"}>…</div>` plus `<ChatThreadsSection collapsed={collapsed} />`) with:

```tsx
        <DashboardsSection collapsed={collapsed} />
```

Remove the now-unused `IconLayoutDashboard` import (already not in the import list above).

- [ ] **Step 3: Delete the thread-state helper and its test**

```bash
git rm app/lib/sidebar-thread-state.ts app/lib/sidebar-thread-state.test.ts
```

- [ ] **Step 4: Command menu in `app/root.tsx`**

Replace lines 118-141 (the `isChatThread` constant and the two conditional `CommandMenu.Item`s) with:

```tsx
  const location = useLocation();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        chatStorageKey="chat"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          {!location.pathname.startsWith("/dashboard") && location.pathname !== "/home" ? (
            <CommandMenu.Item onSelect={() => navigate("/home")}>
              {t("navigation.dashboards")}
            </CommandMenu.Item>
          ) : null}
```

(keep the agent-settings item and the rest unchanged).

- [ ] **Step 5: Header titles**

In `app/components/layout/Header.tsx` replace `pageTitleKeys` and `resolveTitle`:

```ts
const pageTitleKeys: Record<string, string> = {
  "/observability": "navigation.observability",
  "/agent": "settings.agentTitle",
  "/settings": "navigation.settings",
};

function resolveTitle(pathname: string, t: (key: string) => string): string {
  if (pageTitleKeys[pathname]) return t(pageTitleKeys[pathname]);
  if (pathname.startsWith("/extensions")) return t("navigation.extensions");
  if (pathname.startsWith("/dashboard") || pathname === "/home") return t("navigation.dashboards");
  return APP_TITLE;
}
```

- [ ] **Step 6: CSS**

In `app/global.css` delete the rules for `.chat-sidebar-thread-title-shell`, `.chat-sidebar-thread-title`, `.chat-sidebar-thread-running`, `.chat-sidebar-thread-title[data-overflow="true"]`, `.chat-sidebar-thread-details` and any `@keyframes` only they reference, and the `--chat-sidebar-title-fade` variable. Keep every `.chat-sidebar-history…` rule (the dashboards list uses them).

Run: `rg -n "chat-sidebar-thread|chat-sidebar-title" app` → expected: no output.

- [ ] **Step 7: Typecheck, tests, doctor**

Run: `pnpm typecheck && pnpm vitest --run && pnpm agent-native:doctor`
Expected: all green. Fix any doctor finding before committing.

- [ ] **Step 8: Commit**

```bash
git add app/components/layout/Sidebar.tsx app/root.tsx app/components/layout/Header.tsx app/global.css app/i18n/*.ts
git commit -m "feat(app/sidebar): dashboards list replaces the thread list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Coach instructions and design docs

**Files:**
- Modify: `AGENTS.md` (`CLAUDE.md` is a symlink to it): Coach Tools table rows for dashboards, Onboarding step 8, Application State section
- Modify: `.agents/skills/goal-coaching/SKILL.md:35`
- Modify: `docs/design/04-dashboards.md:29`
- Modify: `BACKLOG.md:10-12`

- [ ] **Step 1: `AGENTS.md`**

Replace the `get-dashboard` / `save-dashboard` row with two rows:

```md
| `list-dashboards` / `create-dashboard` / `archive-dashboard` | The user's dashboards; each has its own chat with you. The one open on screen is `navigation.dashboardId` from `view-screen`. The last dashboard cannot be archived |
| `get-dashboard` / `save-dashboard` | One dashboard by `dashboardId` (/dashboard/:id). You design it: read it, edit the widget list, save the whole config. Revisions allow undo (`list-dashboard-revisions`, `restore-dashboard-revision`, both by `dashboardId`) |
```

Onboarding step 8: replace with

```md
8. **dashboard** — fill the dashboard this chat belongs to (`view-screen` → `navigation.dashboardId`) with
   `save-dashboard`: 4–8 widgets for the top goals, grouped under 2–4 `section` headings (one per goal or theme), using
   the metrics `get-health` actually has (a `number` widget for the headline metric, `line` for trends, `sleep` and
   `workouts` when relevant). If there is no data yet, still save widgets for the goal metrics — they fill in after the
   first sync. Then set `onboardingStage` to `done`.
```

Application State section: replace the first bullet with

```md
- `navigation` describes the current view, and on a dashboard its `dashboardId`. The default view is `dashboard`:
  `/home` opens the most recently updated dashboard; `/` opens the shared sign-in/signup page.
```

Also in the intro paragraph change "the authenticated app starts at `/home`" to "the authenticated app starts at `/home`, the user's dashboard with its coach chat beside it".

- [ ] **Step 2: Skill, design doc, backlog**

`.agents/skills/goal-coaching/SKILL.md` line 35: after "when composing with `save-dashboard`" add " (the open dashboard: `view-screen` → `navigation.dashboardId`)".

`docs/design/04-dashboards.md` line 29: replace "One dashboard per user in v1: id = hash(org, email)." with "Several dashboards per user, one chat per dashboard (`docs/superpowers/specs/2026-10-10-dashboard-first-chat-design.md`); the default one has id = hash(org, email) and is created by `list-dashboards`."

`BACKLOG.md` lines 10-12 (the guided-question entry): drop the sentence "The full-page chat passes translated labels from `chat.guided*`." and leave the upstream pointer.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md .agents/skills/goal-coaching/SKILL.md ../../docs/design/04-dashboards.md BACKLOG.md
git commit -m "docs(app): coach instructions for several dashboards with one chat each

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Browser verification and entropy ledger

**Files:** none (verification only; fix-ups go into the task that owns the file, with their own commit).

- [ ] **Step 1: Dev server**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/home` → expected `200` (the server from `pnpm dev` is already running on 8081; if not, start it in the background).

- [ ] **Step 2: Walk the flows in Chrome (Claude-in-Chrome tools)**

1. Open `http://localhost:8081/home`: it redirects to `/dashboard/dashboard-…`; the right panel is open with an empty chat; the left sidebar shows "Dashboards" with one entry and "New dashboard"; no "New chat", no "+" tab, no tab bar in the panel.
2. Send "ahoj" in the panel; wait for a reply.
3. Click "New dashboard": a second entry appears, the URL changes, the panel shows an empty chat.
4. Rename it from its row menu to "Maratón"; the entry and the page header update.
5. Click the first dashboard: the "ahoj" conversation is back. Click the second: empty again. Repeat once; no third thread appears anywhere.
6. Ask the coach in the second dashboard "Čo vidíš na obrazovke?": the reply names the dashboard id or title (it read `navigation.dashboardId`).
7. Archive "Maratón" from its row menu: it disappears, the URL goes to the first dashboard. Try archiving the last one: a toast says it cannot be archived.
8. Open `http://localhost:8081/dashboard/does-not-exist`: "Dashboard not found." and the sidebar still works.
9. Open Settings → Interface language → Slovak; back to the dashboard: "Dashboardy", "Nový dashboard" in the sidebar.

Record anything that deviates and fix it in the owning task's files, committing with that task's message style.

- [ ] **Step 3: Entropy ledger**

Run: `git diff --stat be88028..HEAD -- apps/app docs | tail -1`
Expected: deletions exceed insertions by roughly 900 lines. Paste the line into the final report.

- [ ] **Step 4: Full verification**

Run: `pnpm typecheck && pnpm vitest --run && pnpm agent-native:doctor`
Expected: all green.
