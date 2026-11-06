# Widget Catalog v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every widget from the approved catalog (26 items, no OHLC) renders on the dashboard, in chat and in the `/dev/widgets` gallery from platform-grounded data, and the coach can compose them.

**Architecture:** Widgets stay one schema (`apps/app/shared/dashboard.ts`) and one entry component (`HealthWidget`), but the 566-line file is split into `apps/app/app/components/widgets/` (one file per family + shared `blocks.tsx`). Numbers are computed by pure, unit-tested functions in `@vitls/physiology` (physiology math) and `apps/app/shared/widget-data.ts` (aggregations of `get-health` results); components only lay them out. New data: catalog metrics, swim workout fields (additive migration + ingest contract), optional profile `birthYear`/`sex`, and a readout setting written by a new `save-readout` action.

**Tech Stack:** TypeScript, React, recharts (no animations), Tailwind + toolkit UI adapter, agent-native actions/settings, Drizzle (PGlite in tests), Vitest, zod 4.

**Spec:** `docs/design/07-widget-catalog.md` (binding). Visual style: existing bento widgets in `apps/app/app/components/dashboard/HealthWidget.tsx` and `apps/app/app/global.css` (`.widget-tint`).

## Global Constraints

- Communicate with the user in Slovak; code, comments, docs, commit messages in English. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage only files you changed (`git add <paths>`), never `git add -A`.
- Tests use in-memory PGlite only; never run anything against the database in `apps/app/.env` (shared dev Postgres).
- No OHLC/candlestick visuals anywhere.
- Three colours only: primary (coral, `hsl(var(--primary))` / `--chart-1`), ink (`--foreground`), grey (`--muted*`, `--background`); stacked parts use opacity steps of these. No shadows. No chart animations (`isAnimationActive={false}`).
- Bento card anatomy (all widgets): `Card.widget-tint flex flex-col gap-4 overflow-hidden p-5`; header = `IconBadge` + title + right-side `Pill` (range / "Today"); body = `flex flex-1 flex-col justify-end gap-4`; headline = small muted label + `Figure` (big number, smaller primary unit) + optional primary `Pill` (delta/status). Line charts bleed edge to edge (`BLEED`), bars and grids keep the padding.
- Every widget has an empty state ("No … yet", muted, centered) and a loading state (`Loading` skeleton) and appears in `/dev/widgets` with demo data, plus at least one empty variant in the "Empty and loading states" section.
- Migrations append-only (unique version + name, additive, no NOT NULL without DEFAULT). Ingest contract changes stay backward compatible (new fields optional).
- Derived physiology numbers live in `@vitls/physiology` (deterministic, tested); the coach never computes them.
- Verification for every task: `pnpm --filter @vitls/app test`, `pnpm --filter @vitls/app typecheck` (pre-existing BETTER_AUTH_SECRET warnings are noise; exit code counts), `pnpm --filter @vitls/app run doctor`; physiology/ingest tasks also run their package tests.

## Review Focus

1. **Sparse platform data** — a user with only Apple Health (no zones, no sets, SDNN instead of RMSSD) sees helpful empty states, never crashes or `NaN`. Each aggregation test includes an empty/partial input.
2. **Timezones** — streak/calendar/sleep-schedule bucket by the `date` strings `get-health` returns (already local-ish day keys); never re-derive days from `Date` in the browser timezone. Tests use fixed date strings.
3. **Unit consistency** — circumferences in metres (canonical), shown in cm; energy balance uses kcal on both sides; 1RM in kg; swim pace per 100 m from metres and seconds.
4. **Readiness without Garmin** — computed from HRV/RHR/sleep baselines; with fewer than 7 baseline days the widget says "Not enough history" instead of a score.
5. **Coach invents nothing** — `milestone.since`, ring `target`, streak thresholds come from the user/memory; tool descriptions say so.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/physiology/src/index.ts` (+ test) | `summarize().sd`, `readiness`, `estimate1RM`, `vo2maxPercentile` |
| `apps/app/shared/widget-data.ts` (+ test) | Pure aggregations: streak days, zone totals, weekly volume, long session, calendar grid, energy balance, sleep stages/schedule, anomalies, lift series, PRs, muscle volume, swim stats |
| `apps/app/shared/dashboard.ts` (+ test) | Widget schema: new kinds and views |
| `packages/health-ingest/src/{catalog,batch}.ts` | New metrics; workout `poolLengthM`, `strokes` |
| `apps/app/server/db/schema.ts`, `server/plugins/db.ts`, `server/lib/ingest/ingest.ts`, `server/lib/health/read.ts` | Swim columns, `get-health` workouts `types` filter + swim fields |
| `apps/app/shared/coach.ts`, `server/lib/coach/readout.ts`, `actions/save-readout.ts`, `actions/get-coach-profile.ts` | Profile `birthYear`/`sex`; readout setting + action |
| `apps/app/app/components/widgets/*.tsx` | Components per family (see tasks) |
| `apps/app/app/components/dashboard/HealthWidget.tsx` | Thin re-export of `widgets/index.tsx` (keeps imports stable) |
| `apps/app/app/routes/dev.widgets.tsx` | Gallery entries for every widget |
| `apps/app/actions/{save-dashboard,show-widget}.ts`, `.agents/skills/{goal-coaching,morning-readout}/SKILL.md`, `AGENTS.md` | Coach knows the catalog |

---

### Task 1: Split the widget file into `components/widgets/` (no behaviour change)

**Files:** Create `apps/app/app/components/widgets/{blocks.tsx,metric.tsx,sleep.tsx,workouts.tsx,training.tsx,macros.tsx,index.tsx}`; replace `apps/app/app/components/dashboard/HealthWidget.tsx` with `export * from "../widgets";`.

**Interfaces (produced, used by every later task):**
- `blocks.tsx` exports: `IconBadge`, `Pill`, `Figure`, `Ring`, `RING`, `Wave`, `Bars`, `DateSpan`, `Empty`, `Loading`, `BLEED`, `tooltipStyle`, `formatParts`, `formatValue`, `clock`, `WidgetMenu`.
- `index.tsx` exports: `HealthWidget`, `WidgetDemo`, `HealthResult`, `Session`, `formatParts`, `formatValue`, `Figure`, `IconBadge`, `Pill`, `Ring` (everything currently exported from `HealthWidget.tsx`, same names and signatures).
- A **body registry** in `index.tsx`: `type BodyProps = { widget: W; data?: HealthResult; loading: boolean; error?: string }` and a `BODIES: Record<WidgetKind, …>` map plus `paramsFor(widget, today): object | null` (the `get-health` query per kind; `null` = no health query, e.g. `training`, `readout`, `milestone`). Later tasks add one entry per new kind instead of growing a switch.

- [ ] Move code verbatim into the family files; `HealthWidget` renders header + `BODIES[widget.kind]`; `HealthDataBody` uses `paramsFor`.
- [ ] `pnpm --filter @vitls/app typecheck && pnpm --filter @vitls/app test && pnpm --filter @vitls/app run doctor` pass; `/dev/widgets` renders the same (check it in the browser if available, otherwise state it).
- [ ] Commit `refactor(app/widgets): split widget components by family`.

---

### Task 2: Physiology functions

**Files:** Modify `packages/physiology/src/index.ts`, `packages/physiology/src/index.test.ts`.

**Produces:**
```ts
// summarize(...) result gains: sd: number | null  (population SD of the baseline window, 2 decimals)
export function readiness(input: {
  hrv?: { recent: number | null; baseline: number | null; days: number };
  rhr?: { recent: number | null; baseline: number | null; days: number };
  sleepHours?: number | null;        // last night
  platformScore?: number | null;     // Garmin training_readiness 0–100
}): { score: number | null; verdict: "train" | "easy" | "rest" | null; drivers: { key: "hrv" | "rhr" | "sleep"; deltaPct: number; effect: "up" | "down" | "flat" }[]; enoughHistory: boolean };
export function estimate1RM(weightKg: number, reps: number): number;          // Epley: w * (1 + reps/30); reps <= 1 → w; reps capped at 12
export function vo2maxPercentile(vo2max: number, age: number, sex: "male" | "female"): number; // 0–100, ACSM/Cooper table by decade 20–79, linear interpolation
```
Rules for `readiness` (document in code):
- `enoughHistory` = HRV or RHR baseline built from ≥ 7 days.
- Component scores: HRV `50 + 2.5 × deltaPct` (higher is better), RHR `50 − 4 × deltaPct` (lower is better), sleep `clamp((hours − 5) / 3 × 100)`; each clamped 0–100; score = mean of available components, rounded. If `platformScore` is given, `score = platformScore` (drivers still computed).
- Verdict: ≥ 67 `train`, ≥ 40 `easy`, else `rest`; `null` when no score.
- Drivers: one per available component, `deltaPct` = (recent − baseline)/baseline × 100 rounded 1 dp (sleep: vs 8 h), effect by sign with ±3 % as flat.

- [ ] Write tests first: `sd` on a known series; readiness — all three components, HRV-only, platform override, < 7 days → `enoughHistory false` and score still null when no component has a baseline; `estimate1RM(100, 5) ≈ 116.67`, `estimate1RM(100,1) = 100`, reps capped at 12; `vo2maxPercentile(42, 35, "male")` within a sensible band (document the table source rows used), monotonic in vo2max, clamps to 1–99.
- [ ] Implement, run `pnpm --filter @vitls/physiology test`, commit `feat(physiology): readiness, 1RM, VO2max percentile, baseline SD`.

---

### Task 3: Data model — metrics, swim fields, profile, workouts filter

**Files:** `packages/health-ingest/src/catalog.ts`, `packages/health-ingest/src/batch.ts` (+ tests); `apps/app/server/db/schema.ts`, `server/plugins/db.ts` (migration 15), `server/lib/ingest/ingest.ts`, `server/lib/health/read.ts` (+ tests); `apps/app/shared/coach.ts`.

**Produces:**
- Catalog: daily `hrv_sdnn_night` (ms, avg, "Overnight HRV (SDNN, Apple)"); point `lean_mass` (kg); point `shoulders`, `chest`, `hips`, `neck`, `arm`, `thigh` (m, "… circumference (manual)").
- Workout ingest item: `poolLengthM?: number (10–100)`, `strokes?: int ≥ 0` (optional, backward compatible).
- Migration 15 `workouts-swim-fields`: `ALTER TABLE workouts ADD COLUMN IF NOT EXISTS pool_length_m DOUBLE PRECISION; … strokes INTEGER;` schema columns `poolLengthM`, `strokes`; upsert writes them.
- `get-health` workouts: optional query `workoutTypes?: string[]` (case-insensitive substring match on `type`), result items add `poolLengthM?`, `strokes?` (zones/sets already returned). Action `get-health` schema gains `workoutTypes`.
- Profile: `birthYear?: int 1900–current`, `sex?: "male" | "female"` with descriptions; `update-coach-profile` accepts them (same schema).

- [ ] Tests first: ingest parses and stores swim fields (extend `server/lib/ingest/ingest.test.ts`); old batches without them still pass; get-health returns them and filters by `workoutTypes`; catalog has the new keys with the right units; profile schema accepts/rejects ranges.
- [ ] Implement; package + app tests, typecheck, doctor; commit `feat(health): swim fields, circumference and lean-mass metrics, profile age and sex`.

---

### Task 4: Readout storage and action

**Files:** Create `apps/app/server/lib/coach/readout.ts` (+ test), `apps/app/actions/save-readout.ts`; modify `apps/app/actions/get-coach-profile.ts` (return `readout`), `apps/app/server/plugins/agent-chat.ts` (`INITIAL_TOOL_NAMES` += `save-readout`), `.agents/skills/morning-readout/SKILL.md` (call `save-readout` with the directive and ≤ 3 highlights after composing the readout).

**Produces:** user setting `vitls-readout` = `{ date: "YYYY-MM-DD", directive: string (≤ 280), highlights: { metric: string; note: string (≤ 80) }[] (≤ 3) }`; `saveReadout(email, input)` validates with zod and overwrites; `getReadout(email)` returns it or null. Action `save-readout` (owner via `requireOwner`). `get-coach-profile` result adds `readout`.

- [ ] Test: save then read; rejects > 3 highlights / long directive; another user reads null.
- [ ] Implement, verify, commit `feat(app/coach): save-readout for the readout widget`.

---

### Task 5: Aggregations and widget schema

**Files:** Create `apps/app/shared/widget-data.ts` (+ `widget-data.test.ts`); modify `apps/app/shared/dashboard.ts` (+ test).

**Schema additions** (all with `...common`; ranges reuse `range`):
```
metric view: "number" | "line" | "bar" | "ring" | "trend" | "band" | "rate"; metric field compare?: <chartable metric>
{ kind: "readout" }
{ kind: "water-vs-fat" }
{ kind: "readiness" }
{ kind: "streak", habit: "weigh-in" | "workout" | "log-food" | "metric", metric?: chartable, min?: number, max?: number }  // metric habit requires metric and min or max (refine)
{ kind: "milestone", label: string(1–60), since: YYYY-MM-DD }
{ kind: "anomalies", range, threshold?: number (1–50, default 10) }
{ kind: "circumferences" }
{ kind: "energy-balance", range }
{ kind: "meals" }
sleep: view?: "duration" | "stages" (default duration)
{ kind: "sleep-schedule", range }
{ kind: "volume", sport: "run" | "ride" | "swim" | "all", range }
{ kind: "zones", range }
{ kind: "long-session", sport: "run" | "ride" | "swim", range }
{ kind: "swim", range }
{ kind: "lift", exercise: string(1–80), range }
{ kind: "muscle-volume", range }
{ kind: "prs", range }
{ kind: "calendar" }               // fixed 12 weeks
{ kind: "tdee", range }
metric view "ring" on vo2max: when profile age/sex exist the centre shows the percentile (Task 9 passes profile)
```
**Aggregations** (pure; inputs are `get-health` result shapes; all tolerate empty input):
```ts
streakDays(days: { date: string; ok: boolean }[], today: string): { current: number; grid: { date: string; ok: boolean | null }[] } // grid = last 28 days Monday-aligned, null = future/no data
zoneTotals(workouts): { zone: number; seconds: number }[] ; easyShare(totals): number | null   // zones 1–2 share
weeklyVolume(workouts, sport): { week: string; distanceM: number; minutes: number }[]          // ISO weeks, Monday
longestPerWeek(workouts, sport): { week: string; distanceM: number }[]
calendarGrid(workouts, today: string): { date: string; minutes: number }[]                    // 84 days, Monday-aligned
energyBalance(dailyIntake, dailyTotal): { date: string; balance: number }[]                    // only days with both
sleepStages(sessions): { date: string; deep; rem; light; awake }[]                             // minutes, by wake date
sleepSchedule(sessions): { date: string; bed: number; wake: number }[] ; regularity(rows): number | null  // hours since 18:00 baseline, SD of midpoint in minutes
anomalies(daily: Record<string,{ summary }>, threshold): { metric; deviationPct }[]           // |dev| ≥ threshold, sorted by magnitude, max 6
liftSeries(workouts, exercise): { date: string; e1rm: number }[]  ; personalRecords(workouts): { exercise; e1rm; date }[] (top 5)
muscleVolume(workouts, muscleOf: (exercise) => string | null): { muscle: string; sets: number }[] // per week average over range
swimStats(workouts): { date: string; pacePer100s: number; swolf: number | null }[]           // swolf needs poolLengthM + strokes: (seconds/lengths) + strokes/lengths
```
Week keys and day keys are the `YYYY-MM-DD` strings from the data (no browser-timezone `Date` math beyond adding whole days in UTC).

- [ ] Tests first, one `describe` per function, each with a normal case, an empty case and one edge case (Review Focus 1–3); schema test parses every new kind and rejects a `streak` with `habit: "metric"` but no metric/threshold.
- [ ] Implement, verify, commit `feat(app/widgets): catalog schema and data aggregations`.

---

### Task 6: Visual blocks

**Files:** `apps/app/app/components/widgets/blocks.tsx` (+ gallery section "Blocks" is NOT needed; blocks are exercised by Tasks 7–9).

**Produces** (props are plain data; all three-colour, no animation, accessible labels via `aria-label` on the root):
- `DotGrid({ cells: { key; state: "on" | "off" | "none"; title }[]; columns = 7 })` — round dots, on = primary, off = grey, none = transparent outline.
- `StackedBars({ rows: { label: string; parts: number[] }[]; colors: string[]; format })` — vertical stacked bars, rounded top, constant gap like `Bars`.
- `DivergingBars({ rows: { date; value }[]; format })` — zero baseline in the middle; negative (deficit) primary, positive grey.
- `BandLine({ rows: { date; value }[]; low: number; high: number; format })` — edge-to-edge line (primary) over a grey band rectangle; Y domain covers band and data.
- `RangeBars({ rows: { date; start: number; end: number }[]; domain: [number, number]; formatTick })` — vertical floating bars (bed → wake).
- `Heatmap({ cells: { date; value }[]; columns = 12 })` — 7 rows × 12 weeks squares, value steps → primary opacity 0.15/0.4/0.7/1, empty grey.
- `NoteList({ items: { title; detail?; tone?: "primary" | "plain" }[] })` — rounded rows on `bg-background` (like workout rows).

- [ ] Implement; typecheck; render each block once in a temporary gallery section to eyeball, then remove it (blocks appear via widgets in Tasks 7–9); commit `feat(app/widgets): dot grid, stacked/diverging/band/range bars, heatmap, note list`.

---

### Task 7: Coach-native widgets (readout, water-vs-fat, trend, readiness, streak, milestone, anomalies)

**Files:** Create `apps/app/app/components/widgets/coach.tsx`; register in `index.tsx`; gallery entries in `apps/app/app/routes/dev.widgets.tsx` (new section "Coach").

Behaviour per widget (data via `paramsFor`):
- `readout`: reads `get-coach-profile` (`useActionQuery`) → `readout`; shows directive (text-lg) and highlights as `NoteList`; stale (date ≠ today) → muted "Yesterday's readout" label; none → empty "No readout yet today". Icon `IconSun`.
- `water-vs-fat`: `get-health points weight 14d`; uses `points.weight.lastChange` (`deltaKg`, `check.maxPlausibleFatKg`, `check.kcalRequired`) → `StackedBars` single bar split fat (≤ maxPlausible, primary) vs water (rest, grey); figure = delta kg with sign; caption "Real fat change needs ~N kcal". Empty if fewer than 2 weigh-ins.
- metric view `trend`: dots (raw, grey) + EMA line (primary) + 30-day mean (ink, dashed) — use `ema` from `@vitls/physiology` on the client (pure).
- `readiness`: `get-health daily [hrv_rmssd_night, hrv_sdnn_night, resting_hr, training_readiness] 60d + sleep 2d`; physiology `readiness`; `Ring` with score and verdict label; drivers as three `Pill`s ("HRV +6 %"); `enoughHistory false` → empty "Not enough history yet".
- `streak`: weigh-in = days with `points.weight`; workout = days with workouts; log-food = days with `intake_energy`; metric = daily metric within min/max; `streakDays` → figure "N days" + `DotGrid` (4 rows × 7).
- `milestone`: no query; figure = whole days since `since` (computed from today's date string) + label; Icon `IconFlag`.
- `anomalies`: `get-health daily (all) range`; `anomalies()` → `NoteList` rows "Resting heart rate · +8 %" (primary when worse direction is unknown → plain); empty "All within your normal range".

- [ ] Implement; gallery demo data for each (including an empty variant in "Empty and loading states"); typecheck/test/doctor; commit `feat(app/widgets): coach-native widgets`.

---

### Task 8: Body, nutrition and recovery widgets

**Files:** Create `apps/app/app/components/widgets/body.tsx`, `nutrition.tsx`, extend `sleep.tsx`, `metric.tsx`; register; gallery sections "Body & nutrition", "Recovery".

- metric view `rate`: `summarize.ratePerWeek` / latest × 100 → `Ring` against the 1 %/week ceiling (fraction = |rate| / 1, capped), centre "−0.6 %/wk", caption "Healthy pace 0.25–1 %"; primary when inside the band, ink when faster. Only for weight/lean_mass/muscle_mass (others fall back to `line`).
- metric field `compare` (line view): fetch both metrics; two lines (primary = main, ink = compare), legend pills; normalise both to the same day keys.
- `circumferences`: `get-health points [waist, shoulders, chest, hips, neck, arm, thigh] 90d`; `NoteList` rows "Waist 86 cm · −2.4 cm" (change vs first in range); V-taper pill `shoulders / waist` (2 dp) when both exist; empty "Measure with a tape and tell your coach".
- `energy-balance`: `get-health daily [intake_energy, total_energy] range` → `energyBalance` → `DivergingBars`; figure = average daily balance with sign + "kcal/day".
- `meals`: `get-health include meals` today → list of `MealCard`s (compact: one per meal, stacked); empty "No meals logged today".
- sleep view `stages`: `sleepStages` → `StackedBars` (deep primary, REM primary/60, light ink/25, awake grey); figure = average deep+REM share.
- metric view `band`: `summarize` baseline ± sd → `BandLine`; pill "In range" / "Above" / "Below" for the latest value.
- `sleep-schedule`: `sleepSchedule` → `RangeBars` (domain 18:00 → 12:00 next day, ticks 22/02/06/10), figure = regularity ± minutes.

- [ ] Implement with gallery demo + empty variants; verify; commit `feat(app/widgets): body, nutrition and recovery widgets`.

---

### Task 9: Endurance, strength and activity widgets

**Files:** Create `apps/app/app/components/widgets/endurance.tsx`, `strength.tsx`, `activity.tsx`; register; gallery sections "Endurance & swim", "Strength", "Activity". Pass profile (`get-coach-profile`) for the VO2max percentile.

- `volume`: `weeklyVolume` → `Bars` of km per week (sport filter via `workoutTypes`: run → ["run"], ride → ["cycl","ride","bik"], swim → ["swim"]); figure = this week km, pill = minutes.
- `zones`: `zoneTotals` → horizontal `StackedBars` (one bar, zones 1–5 from grey → primary) + "Easy 78 %" pill; empty when no workout has zones ("Your device doesn't report HR zones yet").
- `long-session`: `longestPerWeek` → `Bars`; figure = longest this range.
- `swim`: `swimStats` → `Wave` of pace per 100 m (lower = better, inverted axis label "min/100 m"), SWOLF pill when available; empty "No swims yet".
- vo2max ring: when `metric === "vo2max"` and profile has `birthYear` + `sex`, centre shows the percentile ("Top 28 %") and label "for your age".
- `lift`: `liftSeries(exercise)` → `Wave` of e1RM; figure = best e1RM kg; PR pill with date; empty "No sets logged for <exercise>".
- `muscle-volume`: each set's muscle is resolved server-side — `get-health` workout `sets` items gain `muscle?: string` from the exercise library by name match (`server/lib/exercises.ts`, best-effort, lowercase includes; unmatched → none); `muscleVolume` groups them; rows per muscle with sets/week vs the 10–20 guideline as a small inline bar, unmatched as "other".
- `prs`: `personalRecords` → `NoteList` "Bench press · 112 kg · Oct 2".
- `calendar`: `calendarGrid` → `Heatmap`; figure = active days in 12 weeks.
- `tdee`: average `total_energy` and `active_energy` over range → figure kcal + "Active 24 %" pill + `Bars`.

- [ ] Implement (including the server-side `muscle` resolution with a test in `server/lib/health/read.test.ts`); gallery demo + empty variants; verify; commit `feat(app/widgets): endurance, strength and activity widgets`.

---

### Task 10: Coach wiring and docs

**Files:** `apps/app/actions/save-dashboard.ts`, `apps/app/actions/show-widget.ts` (descriptions list every kind/view with one line each and the "never invent targets/dates" rule), `.agents/skills/goal-coaching/SKILL.md` (default widgets per goal from the spec §5), `apps/app/AGENTS.md` (Coach Tools: `save-readout`; widgets row points to the catalog), `docs/design/07-widget-catalog.md` status → "APPROVED · implemented", `docs/design/04-dashboards.md` (one paragraph pointing to 07).

- [ ] Edit; verify typecheck/test/doctor; commit `docs(app): coach knows the widget catalog`.

---

## Self-review notes
- Spec coverage: items 1–26 → Tasks 7 (1–7), 8 (8–16), 9 (17–26); data (§2, §5) → Tasks 2–4; blocks (§4) → Task 6; testing (§6) → per task; GLP-1 deferred per spec.
- `muscle` resolution moved server-side (Task 9) to keep the exercise library off the client.
