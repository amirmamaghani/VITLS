# Design: training recommendations and widgets in chat

Status: **APPROVED, implemented** · 2026-10-01

## Exercise library
- Source: git submodule `vendor/exercises-dataset` (hasaneyldrm/exercises-dataset, shallow).
- **Data only (MIT):** names, body part, equipment, target/secondary muscles, English step-by-step instructions.
  **No media** (decision 2026-10-01): GIFs/images are © Gym visual and not covered by the MIT license.
- `pnpm --filter @vitls/app exercises:build` writes a bundled index `apps/app/server/lib/exercises.data.json` (~840 KB),
  so deploys don't need the submodule. Re-run after updating the submodule.

## Training plan (coach-designed, native storage)
- User setting `vitls-training`: `{ plan: { name, days: [{ weekday, title, exercises: [{ exerciseId, sets, reps, rir?, note? }] }], notes? } }`.
- Actions: `search-exercises`, `get-training-plan` (plan + today's session in the user's timezone), `save-training-plan`
  (validates exercise ids).
- Coaching rules in the `goal-coaching` skill; the `morning-readout` skill names today's planned session and autoregulates it.

## Widgets
- New dashboard widget kind `training`: today's session (PULSE "Tréning dnes") — exercise, sets × reps, RIR, cue, steps on demand.
- **Every widget can be shown in chat:** `show-widget { widget }` (same schema as dashboard widgets) with chat renderer
  `vitls.widget`, which renders the same `HealthWidget` component as `/dashboard` (quantal `register-chat-renderers` pattern).

## Reducing-entropy check
Mindset: *data over abstractions* — one widget schema for dashboard and chat, one renderer, plan as a setting.
Not built: plan tables, per-widget chat actions, media proxy.
