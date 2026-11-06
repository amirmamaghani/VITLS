---
name: goal-coaching
description: Coaching rules per goal module (fat loss, muscle gain, strength, endurance, VO2max, swim, longevity) and how to combine them for hybrid goals. Use when planning, reviewing progress or adjusting a goal.
scope: runtime
---

# Goal coaching

Respect safety rules and remembered constraints first. Combine goals by priority from `<coach-profile>`; when two goals
conflict (e.g. fat loss vs endurance volume), say so and let the user choose the trade-off.

| Goal | Watch (get-health) | Levers | Healthy pace / signal |
|---|---|---|---|
| fat_loss | weight trend + `ratePerWeek`, body_fat_pct trend, steps, active_energy | moderate deficit, protein ~1.6–2.2 g/kg, resistance training 2–4×/week, steps | 0.25–1 % body weight per week; never below BMI 18.5 |
| muscle_gain | weight trend, muscle_mass, training volume | small surplus, progressive overload, protein, sleep | ~0.25–0.5 % body weight per month for trained people |
| strength | workouts sets (load × reps), readiness | progressive overload, technique, deloads | steady top-set increases; back off when recovery dips |
| endurance | weekly distance, long session, resting_hr, HRV | ~80 % easy volume, +≤10 % weekly volume, one long session | resting HR down, pace at same HR up |
| vo2max | vo2max, intensity_minutes | 1–2 interval sessions/week on an easy base | slow climb over months |
| swim | distance, sessions | technique blocks, interval sets | consistency first |
| longevity | sleep, HRV, resting HR, steps, weight stability | sleep regularity, daily movement, strength 2×/week, stress | trends stable or improving |

- Base advice on the user's data; when a lever has no data (e.g. no food log), ask or keep it general.
- Progress review: compare the current trend to the target date; if off pace, adjust one lever at a time.

## Training plan

- Build or change the weekly plan with `search-exercises` → `save-training-plan`; respect injuries and equipment from memory,
  the user's schedule (training days per week) and the goal priorities. 4–8 exercises per session, sets × reps with RIR,
  one short cue each; rest/cardio days stay in the plan with no exercises.
- Progression: add reps within the range, then load; deload every 4–6 weeks or when recovery trends down.
- Show the result with `show-widget` `{ kind: "training" }`, then offer to add the `training` widget to the dashboard.

## Default dashboard widgets per goal

The dashboard header already shows today's readout directive, so add the `readout` widget only when its highlights matter. Group the board into 2–4 `section` headings (one per top goal or theme: Body, Recovery, Nutrition, Training), widgets after their heading. Pick from these when composing with `save-dashboard` (the open dashboard: `view-screen` → `navigation.dashboardId`), only for data that exists; never invent targets (ring), dates (milestone) or thresholds (streak): take them from goals/memory or ask. Kinds, views and fields: the `save-dashboard` / `show-widget` tool descriptions.

| Goal | Widgets |
|---|---|
| fat_loss | `water-vs-fat`, weight `trend`, weight `rate`, `energy-balance`, protein `ring` |
| muscle_gain | weight `trend`, `rate`, `lift`, `muscle-volume`, protein `ring` |
| strength | `lift`, `muscle-volume`, `prs`, `training` |
| endurance | `volume`, `zones`, `long-session`, vo2max `line` |
| swim | `volume` (swim), `swim`, `long-session` (swim) |
| vo2max | vo2max `line` / `ring`, `zones`, `volume` |
| longevity | `readiness`, `band` for HRV and resting HR, sleep `stages`, `sleep-schedule`, vo2max |
