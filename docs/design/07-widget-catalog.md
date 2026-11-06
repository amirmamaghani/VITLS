# Design: widget catalog v2 (coach-native, goal widgets, new visuals)

Status: **APPROVED · implemented** · 2026-10-07

## 1. Scope and principles

- Extends the dashboard/chat widget system (`shared/dashboard.ts`, `HealthWidget`, `/dev/widgets` gallery) with the
  catalog brainstormed on 2026-10-07. **No OHLC/candlesticks** (rejected).
- **Grounded in platform data.** Every widget reads what Apple Health, Health Connect or Garmin (through the companion
  or gccli-dev) actually provide, normalized by the existing ingest contract. Derived numbers are deterministic math
  in `@vitls/physiology` (decision D8: no body-composition models); the coach interprets, never computes.
- One widget schema for dashboard and chat (`show-widget`), bento style, three colours, every widget in the gallery
  with demo data plus empty/loading states. Widgets degrade gracefully when a source lacks a field.
- Split `HealthWidget.tsx` (already large) into `app/components/widgets/` — one file per family, shared building blocks
  (`IconBadge`, `Pill`, `Figure`, `Ring`, `Wave`, `Bars`) in `blocks.tsx`.

## 2. Platform data map

| Data | Apple Health | Health Connect | Garmin | In VITLS today |
|---|---|---|---|---|
| Sleep stages (deep/REM/light/awake) | ✅ | ✅ | ✅ | `sleep_sessions.stages` → `get-health sleep.stageMinutes` |
| Sleep start/end | ✅ | ✅ | ✅ | `sleep_sessions.start/end` |
| HRV | ✅ SDNN | ✅ RMSSD | ✅ RMSSD | `hrv_rmssd_night` (SDNN stored as `hrv_sdnn_night`, new) |
| Resting HR, VO2max, steps, active/total energy | ✅ | ✅ | ✅ | daily metrics |
| Training readiness, Body Battery, stress, fitness age | — | — | ✅ | daily metrics |
| Workout HR zones | derived from HR samples (companion) | derived | ✅ | `workouts.zones` |
| Strength sets (exercise, reps, kg) | — | ✅ ExerciseSegment (reps) | ✅ | `workouts.sets` |
| Swim distance, pool length, strokes | ✅ (strokes, laps) | ✅ (laps, segments) | ✅ (+ SWOLF) | distance only → **add `poolLengthM`, `strokes`** |
| Waist | ✅ | — | — | `waist` |
| Other circumferences (shoulders, chest, hips, neck, arm, thigh) | — | — | — | **new point metrics, manual entry** |
| Body fat %, lean mass | ✅ | ✅ | ✅ (BIA scales) | `body_fat_pct`, `muscle_mass` (+ `lean_mass`, new) |
| Date of birth, sex | ✅ (characteristics) | — | ✅ (profile) | **new optional profile fields `birthYear`, `sex`** |
| Nutrition, hydration | ✅ | ✅ | — | `intake_*` (plan 5 imports) |

## 3. Widget catalog

New widget kinds and metric views (schema in `shared/dashboard.ts`; all accept `title?`, `wide?`):

**Coach-native**
1. `readout` — today's coach directive + up to 3 key numbers. Source: new user setting `vitls-readout`
   `{ date, directive, highlights: [{ metric, note }] }` written by a new action `save-readout`, called by the
   `morning-readout` skill. Shows "No readout yet today" before the job ran.
2. `water-vs-fat` — latest weigh-in change split into plausible fat vs water/glycogen/salt
   (`fatChangeCheck`, existing `points.weight.lastChange`); stacked bar + the kcal math as caption.
3. metric view `trend` — raw values as dots, EMA trend line, 30-day mean line (`ema`, existing `summarize`).
4. `readiness` — composite from HRV, resting HR and last sleep against personal baselines: new physiology
   `readiness({ hrv, rhr, sleep })` → `{ score 0–100, verdict: "train" | "easy" | "rest", drivers[] }`. Uses Garmin
   `training_readiness` when present (shown as the score, drivers still computed). Ring + verdict pill.
5. `streak` — dot grid of the last 4 weeks for a habit: `{ habit: "weigh-in" | "workout" | "log-food" | "metric",
   metric?, min?, max? }` (e.g. protein ≥ 175 g, steps ≥ 8 000). Current streak as the figure.
6. `milestone` — "days since" from a date the coach knows: `{ label, since: YYYY-MM-DD }` (quit smoking, injury,
   start of the cut). Big number + label; stored in the widget config (the coach writes it from memory).
7. `anomalies` — metrics whose last 7 days deviate from baseline beyond a threshold (default ±10 %): list of pill rows.

**Body**
8. metric view `rate` — trend rate per week as % of body weight, ring against the healthy band (0.25–1 %/week);
   for weight/lean mass only.
9. metric field `compare: <metric>` (line view) — two series on one card (coral + ink), e.g. body fat vs lean mass.
10. `circumferences` — latest tape values with change since first entry; `ratio` pill for V-taper
    (shoulders / waist) when both exist. New point metrics: `shoulders`, `chest`, `hips`, `neck`, `arm`, `thigh`
    (unit m, manual entry; Apple waist keeps flowing in).

**Nutrition** (live once plan 3/5 targets and imports land; render from `intake_*` today)
11. `energy-balance` — diverging bars per day: `intake_energy − total_energy` (deficit below zero in coral).
12. `streak` with `metric: intake_protein` covers weekly adherence; the protein anchor is the existing `ring`.
13. `meals` — today's meals as compact meal cards (the existing `MealCard`), photos once plan 2 lands.

**Recovery**
14. `sleep` view `stages` — stacked bars per night (deep / REM / light / awake) in three-colour tints.
15. metric view `band` — line with the personal normal range (baseline ± 1 SD of the 60-day window); new
    `summarize` fields `sd`. For HRV, resting HR, respiration.
16. `sleep-schedule` — bedtime and wake time per night as vertical range bars; regularity (SD of midpoint) as figure.

**Endurance / run / swim**
17. `volume` — weekly distance (and time) for one workout type family (`run`, `ride`, `swim`, `all`); bars per week.
18. `zones` — time in HR zones over the range from `workouts.zones`, stacked bar + "easy share" (zones 1–2) pill.
19. `long-session` — longest run/ride/swim per week (distance) with the latest as figure.
20. `swim` — pace per 100 m and SWOLF (strokes per length + seconds per length) per session; needs the new workout
    fields `poolLengthM`, `strokes` (ingest contract + `workouts` columns, additive migration).
21. VO2max: existing line/ring views + `percentile` when profile has `birthYear` and `sex` (ACSM/Cooper normative
    table in physiology).

**Strength**
22. `lift` — estimated 1RM (Epley) over time for one exercise from `workouts.sets`; PR pill.
23. `muscle-volume` — weekly hard sets per muscle group vs the 10–20 set guideline; exercises mapped to muscles via
    the exercise library (`search-exercises` data, name match), unmatched counted as "other".
24. `prs` — best estimated 1RM per exercise (top 5) with dates.

**Activity**
25. `calendar` — 12-week heatmap of workout minutes per day (Monday-first grid, primary intensity steps).
26. `tdee` — average total energy (7/30 days) as figure with active share pill.

GLP-1 widgets (symptoms, minima) come with plan 4 and reuse `ring`, `streak` and `compare`.

## 4. New visual building blocks

`DotGrid` (streak, adherence), `StackedBars` (sleep stages, zones, water vs fat), `DivergingBars` (energy balance),
`BandLine` (normal range), `RangeBars` (sleep schedule), `Heatmap` (calendar), `Duo` line (compare), `Note` card
(readout, anomalies). All recharts-free where SVG/CSS is simpler (dot grid, heatmap, range bars), recharts for the rest;
no animations; three colours (primary coral, ink, grey) with opacity steps for stacked parts.

## 5. Data and actions

- `get-health` gains a `widgets`-friendly section where needed: `sleep` already has stages; add `workouts` filters
  (`types`) and per-workout `sets`/`zones`/swim fields (already returned except swim).
- New: `save-readout` (+ `get-coach-profile` returns the latest readout), physiology `readiness`, `estimate1RM`,
  `vo2maxPercentile`, `summarize().sd`.
- Ingest contract: workout `poolLengthM?`, `strokes?`; catalog: `hrv_sdnn_night`, `lean_mass`, circumference metrics;
  profile: `birthYear?`, `sex?` (asked during onboarding "data" stage only if a widget needs them).
- Coach: `save-dashboard`/`show-widget` descriptions list every kind; `goal-coaching` skill maps goals to default
  widgets (fat loss → water-vs-fat, trend, rate, energy-balance, protein ring; endurance → volume, zones,
  long-session, VO2max; strength → lift, muscle-volume, prs, training; longevity → readiness, band HRV/RHR,
  sleep stages, VO2max percentile; everyone → readout).

## 6. Testing

Pure functions (`readiness`, `estimate1RM`, `vo2maxPercentile`, `sd`, streak/zones/volume aggregations,
`ringProgress`-style helpers) unit-tested in `@vitls/physiology` / `shared`; schema accepts every kind; gallery renders
every widget with demo data and empty states; ingest test for the new workout fields; typecheck + doctor.

## 7. Open items

- HR zones for Apple/Health Connect workouts depend on the companion deriving them from HR samples (companion work).
- Exercise-name matching for muscle volume across Garmin/HC naming is best-effort; unmatched → "other".
