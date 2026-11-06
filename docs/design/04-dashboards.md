# Design: agent-designed dashboards

Status: **APPROVED ("davaj"), implementing** · 2026-10-01
Study basis (agent-native-first step 1): `@agent-native/core/dashboard-storage` (schema/store d.ts), corpus `crm`
(`save-crm-dashboard` full-config save, DDL), `analytics` (mutation API — rejected as too large for our config size),
quantal `apps/agent` (`shared/dashboard.ts`, 5 small actions, grid route), `@agent-native/toolkit/dashboard`
(`GenericChartPanel`, `MetricCard`), `data-widgets` (chat charts). Decision D6: **the agent designs the dashboard**,
no fixed per-goal layouts.

The widget kinds and metric views have grown since this design; the current catalog, with each widget's fields and the goal-to-widget defaults, is `docs/design/07-widget-catalog.md`.

## 1. Config — data, three widget kinds

```ts
{ version: 1, widgets: [ // ≤ 12, unique ids
  { id, kind: "metric",   metric: <catalog key>, view: "number" | "line" | "bar", range: "7d" | "30d" | "90d", bucket?: "day" | "week" | "month", title?, wide? },
  { id, kind: "sleep",    range, title?, wide? },
  { id, kind: "workouts", range, title?, wide? },
] }
```

Every widget reads through **one** path: `get-health` with params derived from the widget (`metrics`, `include`, `from/to`,
`bucket`). No widget-specific actions or queries. Goal modules already list their relevant metrics (`GOAL_MODULES[*].metrics`),
which is all the agent needs to compose a first dashboard.

## 2. Storage — native `dashboard-storage`

Tables `vitls_dashboards`, `vitls_dashboard_revisions`, `vitls_dashboard_shares` (migration v12, DDL from corpus/quantal).
Several dashboards per user, one chat per dashboard (`docs/superpowers/specs/2026-10-10-dashboard-first-chat-design.md`); the default one has id = hash(org, email) and is created by `list-dashboards`. Revisions (undo) and optimistic concurrency (`expectedUpdatedAt`)
come from the store. Sharing registered (`allowPublic: false`) so a coach can later be given view access.
Dashboards join the identity registry with `offboard: "delete"` (personal health view, never transferred).

## 3. Actions — four

| Action | Notes |
|---|---|
| `get-dashboard` | config + `updatedAt`; empty config until the first save |
| `save-dashboard` | full config + optional `expectedUpdatedAt` (agent: get → edit → save; UI uses the same action) |
| `list-dashboard-revisions` | revision metadata for undo |
| `restore-dashboard-revision` | restore (itself undoable) |

## 4. UI

- Route `/dashboard`, sidebar link, page title.
- Responsive grid (1 column mobile, 2 desktop; `wide` spans both). Each widget: title, `GenericChartPanel` (line/bar) or
  `MetricCard` (number with trend/baseline from the summary), remove and move up/down buttons (no drag-and-drop library).
- Empty state and an "Ask the coach to change this" button (`sendToAgentChat`).
- Live refresh on new device data via `useChangeVersion("health")` (ingest already records changes).
- Navigation state exposes view `dashboard`, so the agent can open it with `navigate`.

## 5. Chat

`show-widget` renders any dashboard widget inline in chat with the same `HealthWidget` component (registered as the
`vitls.widget` action chat renderer), so a widget looks identical in both places. `get-health` has no chat UI of its own:
a second, generic chart for the same data duplicated the widget and could not draw point metrics such as weight.

## 6. Reducing-entropy check

Mindset: *data over abstractions*. Rejected: typed mutation ops (analytics: ~2,900 lines), per-goal default layouts,
drag-and-drop dependency, per-widget data actions. Net: 4 small actions + 1 config schema + 1 route + 1 widget component.
