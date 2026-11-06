# Upstream issue draft: dashboard-storage conditional writes fail on the postgres.js driver

**Package:** `@agent-native/core` 0.198.8 (unchanged in 0.201.1), `dist/dashboard-storage/store.js`

## Symptom
`createDashboardStorage(...).write({ ..., expectedUpdatedAt })` always throws on a Postgres database reached through
the `postgres` (postgres.js) driver when the config changed:

```
Error: Dashboard storage requires affected-row counts for conditional writes.
    at .../dashboard-storage/store.js:279
```

## Cause
`affectedRowCount(result)` only reads `rowCount`, `rowsAffected` or `changes`. Drizzle's postgres.js driver returns
the driver's `RowList`, which reports affected rows as `count` (no `rowCount`):

```js
const r = await sql`UPDATE vitls_dashboards SET title = title WHERE false`;
// { count: 0, command: "UPDATE" }  — r.rowCount is undefined
```

PGlite and node-postgres expose one of the checked keys, so tests on PGlite pass while production Postgres fails.

## Suggested fix
Add `"count"` to the keys `affectedRowCount` checks (`["rowCount", "rowsAffected", "changes", "count"]`), and add a
dashboard-storage test that runs a conditional write through the postgres.js driver.

## Workaround in VITLS
`apps/app/actions/save-dashboard.ts` checks `expectedUpdatedAt` itself (read current → 409 on mismatch) and calls
`write` without `expectedUpdatedAt`. Remove the workaround once the fix ships.
