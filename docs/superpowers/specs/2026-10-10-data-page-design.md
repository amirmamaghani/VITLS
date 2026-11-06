# Design: the Data page — every widget in an expanded, raw mode

Date: 2026-10-10. Status: approved in chat. Depends on `2026-10-10-top-bar-layout-design.md` (the `/data` route exists as a placeholder).

## 1. Intent

Data is the transparency page: what the coach knows about the user, from which source, and a way to take it out.
It is not a second dashboard (that is the coach's selection) and not a data editor (manual values are changed through
chat or the Log value modal). Decisions from the chat on 2026-10-10:

- purpose: overview + transparency + export;
- presentation: the same widgets as the dashboard, in an "expanded mode" that shows what the widget hides;
- history: all of it, lazy-loaded.

Success: a user opens Data, sees every metric that has at least one record grouped by theme, opens one, sees the big
chart, the per-source values with the winner marked, the coverage of days, a raw table that keeps loading older rows as
they scroll, and downloads that metric (or everything) as CSV or JSON. From a dashboard widget's `⋯` menu, "Show data"
lands on the same expanded view.

## 2. Framework and app pieces reused

| Need | Reused |
| --- | --- |
| Charts and cards | `HealthWidget` (`app/components/widgets`) with `demo`-less live bodies; `wide` for the expanded chart |
| Metric catalog (keys, kinds, units, descriptions) | `METRICS`, `getMetric` from `@vitls/health-ingest` |
| Source priority (who wins a day) | `SOURCE_PRIORITY` / `rank` in `server/lib/health/read.ts` (exported) |
| Data reads | new actions, `defineAction` + `useActionQuery`; no `/api` routes |
| Tables, menus, buttons | toolkit `Table*`, `DropdownMenu*`, `Button`, `Card` via `components/ui` |
| Export | built in the browser from the loaded rows (Blob + `<a download>`); no server endpoint |

## 3. Changes

### 3.1 Actions (`apps/app/actions`, `server/lib/health`)

- `get-data-catalog` (GET, readOnly): `{}` → `{ sources: { id, provider, via, label, lastSyncAt, status, rows }[],
  metrics: { key, kind, unit, rows, firstDay, lastDay }[], sections: { sleep: {rows, firstDay, lastDay}, workouts: …,
  meals: … } }`. Counts come from `GROUP BY` over `daily_metrics`, `point_metrics`, `sleep_sessions`, `workouts`,
  `meals`, scoped by `owner_email`. One round trip renders the page.
- `get-health-raw` (GET, readOnly): `{ metric?: string; section?: "sleep" | "workouts" | "meals"; before?: string;
  days?: number (default 92, max 366) }` → `{ rows, sources, nextBefore }`. Exactly one of `metric` / `section`.
  Rows are unresolved: for a daily metric every (day, source) row; for a point metric every (at, source) row; for
  sections the session/meal records with their items. Each row carries `source: { provider, via, label }`,
  `updatedAt` (when it was last written), and for daily/point rows `winner: boolean` (the row `get-health` would pick,
  by `rank(provider)`). The window is `[before - days, before)` by day (default `before` = tomorrow in UTC);
  `nextBefore` is the window start, or `null` when nothing older exists (one cheap `MIN(day)` query decides).
  Both actions are coach tools too ("why do Garmin and Apple disagree on Tuesday?").

### 3.2 Catalog page `/data` (`app/routes/data.tsx` + `app/components/data/DataCatalog.tsx`)

- **Sources strip**: one card per source: provider name, via, label, last sync (relative), row count, status badge.
  Right: "Export all" (JSON of every metric and section, assembled by walking `get-health-raw` windows until
  `nextBefore` is null, one file).
- **Groups**: Activity, Recovery, Body, Nutrition (daily/point metrics by a key→group map in `shared/data-catalog.ts`),
  then Sleep, Workouts, Meals (sections), then Intraday when the plan has it. Inside a group one small `HealthWidget`
  per metric with rows > 0 (default views: daily → `line`, point → `trend`, sleep → `duration`, workouts → list,
  meals → today's list), range 90 d. Clicking the card or its `⋯` → "Show data" opens the expanded mode.
- Catalog metrics with zero rows are listed in one muted line per group: "No source yet: floors, vo2max".

### 3.3 Expanded mode `/data/:key` (`app/routes/data.$key.tsx` + `app/components/data/MetricDetail.tsx`)

`key` is a metric key or `sleep` | `workouts` | `meals`.

- Header: title, unit, catalog description, source chips; range pill (7 d / 30 d / 90 d / 1 y) for the chart only.
- Chart: the same `HealthWidget` as on the dashboard, `wide`, driven by the range pill.
- **Sources and conflicts** (daily/point only): rows where more than one source reported the same day/time, each source's
  value side by side, the winner marked; "no conflicts" when there are none.
- **Coverage**: a strip of all days from first to last record, one cell per day, colored by the winning source,
  empty for gaps; a legend of sources.
- **Raw rows**: a table (date/time, value in the display unit, canonical value + unit, source, winner, updated at); for
  sections: one row per session/meal with the detail (stages, zones/sets, items) in an expandable row. Rows load
  newest-first in 92-day windows; an `IntersectionObserver` sentinel at the end requests the next window until
  `nextBefore` is null ("Loading older…" / "That's everything, N rows").
- **Export**: "CSV" and "JSON" for this key, all history: walks the remaining windows first, then downloads.

### 3.4 Dashboard link

`WidgetMenu` gets an optional `dataHref`; `HealthWidget` passes `/data/<metric or kind>` for metric, sleep, workouts,
meals widgets (nothing for readout/training/composite widgets). Menu item "Show data".

### 3.5 i18n

A `data` block in all 13 catalogs: `title`, `sources`, `lastSync`, `rows`, `exportAll`, `exportCsv`, `exportJson`,
`showData`, `noSourceYet`, `conflicts`, `noConflicts`, `coverage`, `rawRows`, `winner`, `loadingOlder`, `allLoaded`,
`groupActivity`, `groupRecovery`, `groupBody`, `groupNutrition`, `groupSleep`, `groupWorkouts`, `groupMeals`,
`groupIntraday`. (The widget bodies keep their existing English copy; localizing widgets is a separate task.)

### 3.6 Coach instructions

`AGENTS.md`: `get-data-catalog` and `get-health-raw` in the tools table (explain source conflicts; never change data
from them), `data` view = `/data`, `/data/:key`.

## 4. Entropy ledger (estimate)

| | lines |
| --- | --- |
| Added: 2 actions (+ tests), `shared/data-catalog.ts` (groups, default views), `DataCatalog`, `MetricDetail`, 2 routes, export helper, i18n block × 13 | ≈ +650 |
| Deleted: the `/data` placeholder body | ≈ −5 |

A new capability; nothing to delete. Mindset: data over abstractions — the raw action returns plain rows and the page
renders them; no view-model layer, no per-metric components.

## 5. Open points

- Intraday series (premium) are large; v1 shows them in the catalog as a count and a coverage strip only, no raw table.
- Ingest batches (the encrypted raw archive) are not shown; "Export all" exports normalized rows, not device payloads.
- Encrypted fields (sleep stages, workout sets, meal names) are decrypted server-side as `get-health` already does.
- The coverage strip for years of daily data is one cell per day: 3 years ≈ 1 100 cells, rendered as `<div>`s in a
  CSS grid; fine. Reassess if it ever covers decades.
