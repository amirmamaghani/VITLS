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
