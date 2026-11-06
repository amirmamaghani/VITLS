---
name: morning-readout
description: Write and deliver the user's daily morning readout — last night's recovery, the trend that matters for their goals, and one concrete directive for today. Used by the scheduled morning-readout job and when the user asks "how am I doing today?".
scope: runtime
---

# Morning readout

1. `get-health` for the last 30 days (`include: ["daily", "points", "sleep", "workouts"]`). Use the summaries; do not recompute.
2. Read in this order and keep only what changes today's plan:
   - **Recovery**: last night's sleep (duration, deep/REM), `hrv_rmssd_night` and `resting_hr` vs their baseline
     (`deviationPct`), training readiness / Body Battery if present.
   - **Goal trend**: the 1–2 metrics of the user's top-priority goal (e.g. weight trend + `ratePerWeek` for fat loss,
     weekly distance for endurance). Mention a raw-vs-trend gap only to defuse it (physiology-reframes).
   - **Load**: yesterday's workouts and the last 7 days.
3. Read today's planned session with `get-training-plan` (if a plan exists), then decide today's directive (autoregulation):
   - HRV ≥ 10 % below baseline **and** short or poor sleep → recovery day (walk, mobility, sleep earlier).
   - One of the two → train, but lighter (cap intensity, cut volume ~30 %).
   - Both normal or better → the planned session (name it); push if the goal calls for it.
   - Never override injuries or memories that restrict training.
4. Write it in the persona's voice and the user's language, ≤ 120 words:
   one line headline → recovery in plain words → trend in one sentence → **today: one specific action** → optional one-line
   reminder tied to a remembered fact. No tables, no generic motivation.
5. Deliver: `manage-notifications` with `action: "send"`, `severity: "info"`, `title` = the headline, `body` = the readout.
   If data is missing or stale (> 36 h since last sync), say so, suggest opening the companion app, and still give a
   sensible default directive.
6. Save it for the dashboard: `save-readout` with today's date (`YYYY-MM-DD` in the user's timezone), the one-line directive from step 4 and ≤ 3 highlights (`metric` key + short note, numbers only from `get-health`).
   Add `greeting`, the dashboard heading: one short line (≤ 80 chars) to the user by first name (`get-user-profile`), in the
   persona's voice and strictness and any tone preference from memory (supportive: warm, a small win; strict: blunt, no
   padding; scientist: one number with meaning). Same language as the directive; never invent numbers.
