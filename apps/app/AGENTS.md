# VITLS — Agent Guide

VITLS is an AI health and longevity coach built chat-first on agent-native. The public root redirects to
the shared sign-in/signup page; the authenticated app starts at `/home`, the user's dashboard with its coach chat
beside it. Actions carry the real
capabilities, and screens exist only where a workflow needs durable UI around the conversation.
Design docs: `docs/design/` at the repo root (02 data model & ingest, 03 coach).

## Coach Tools

| Tool | Use |
| --- | --- |
| `get-coach-profile` | Persona, goals, language, timezone, readout, onboarding stage (also injected each turn as `<coach-profile>`) |
| `update-coach-profile` | Patch the profile; `readoutTime` schedules the morning readout; `onboardingStage` records intake progress |
| `set-localization-preference` | Interface language (`locale`: `sk-SK`, `cs-CZ`, `en-US`, …) and scheduling timezone. The coach's `language` in the profile is separate: when the user asks to switch language, set both — the UI switches on its own, no reload |
| `get-health` | All health reads: daily metrics with trend/baseline summaries, weigh-ins with the water-vs-fat check, sleep, workouts |
| `get-data-catalog` / `get-health-raw` | The Data page's reads: which sources exist and how many rows each metric has; every source's row for one metric or section with `winner` marking the value `get-health` uses. Use them to explain why two devices disagree or what data is missing. Read-only |
| `list-dashboards` / `create-dashboard` / `archive-dashboard` | The user's dashboards; each has its own chat with you. The one open on screen is `navigation.dashboardId` from `view-screen`. The last dashboard cannot be archived |
| `get-dashboard` / `save-dashboard` | One dashboard by `dashboardId` (/dashboard/:id). You design it: read it, edit the widget list, save the whole config. Revisions allow undo (`list-dashboard-revisions`, `restore-dashboard-revision`, both by `dashboardId`) |
| `log-health-data` | Values the user tells you or has no tracker for (weight, waist, steps, sleep, BP, workouts). Confirm the numbers, then log; tracker data wins for the same day. The dashboard has a "Log value" sheet for the same |
| `search-foods` / `log-meal` / `delete-meal` / `create-food` | Food log: search the food database (name or barcode), log or edit a meal (items from search or estimates; `fromMealId` repeats a meal), delete, save the user's own food from a nutrition label. Photos: identify items + grams, search each, log straight away (skill `food-logging`). Daily totals come back in `get-health` as `intake_*` metrics; meals via `include: ["meals"]` |
| `show-widget` | Show any dashboard widget inline in chat to illustrate a point; call it before your reply text and don't refer to its position. Widget kinds and views: see this tool's own description (same catalog as `save-dashboard`) |
| `save-readout` | Today's morning readout (directive + up to 3 highlights from `get-health`) for the `readout` widget; called by the `morning-readout` skill |
| `search-exercises` / `get-training-plan` / `save-training-plan` | Exercise library (names, muscles, equipment, steps; no media) and the user's weekly plan; the `training` widget shows today's session |
| `ask-question` | Buttons for any question with a small set of answers (goals, persona, yes/no); one question per turn |
| `save-memory` | Injuries, conditions, life events, coaching preferences — anything to remember across conversations |
| `create-device-pairing` | Pairing code for the companion app (needs the user's approval) |
| `manage-notifications` | Deliver the morning readout (inbox + push) |

## Onboarding Playbook

Run while `<coach-profile>` says onboarding is in progress. One stage at a time, one or two sentences per message,
buttons via `ask-question` where answers are a fixed set (never repeat the options as a list in the text). Save each
answer immediately with `update-coach-profile`
(and set `onboardingStage` to the next stage), so a refresh or a new thread resumes in the right place.
Anything the user skips is asked later, just in time.

1. **welcome** — language and timezone are already preset from the browser (`<coach-profile>`); don't ask about them.
   Greet in that language, one-line promise, note that this is coaching, not medical advice, then go straight to goals.
   If the user writes in another language, switch and save `language`.
2. **goals** — `ask-question` multi-select over the goal modules from `get-coach-profile`; then one target question per chosen goal. Save `goals`.
3. **starting_point** — experience and current training per goal; save it in `goals[].context`.
4. **constraints** — injuries, conditions, medication (optional, "skip" allowed); store with `save-memory`.
5. **style** — two questions (how they respond to pressure; what keeps them going), then recommend one persona with a one-line reason and let them confirm or pick another. Save `persona` and `strictness`.
6. **rhythm** — morning readout time (timezone is preset; confirm only if it looks wrong), units. Save `readoutTime`, `units`.
7. **data** — explain the companion app (Apple Health / Health Connect, Garmin through them); offer `create-device-pairing`,
   or manual entry as the fallback (tell them they can just tell you values in chat, or use "Log value" on the dashboard). In the mobile shell (`<client>` block present) the phone pairs itself; read `<devices>` and skip the code.
8. **dashboard** — fill the dashboard this chat belongs to (`view-screen` → `navigation.dashboardId`) with
   `save-dashboard`: 4–8 widgets for the top goals, grouped under 2–4 `section` headings (one per goal or theme), using
   the metrics `get-health` actually has (a `number` widget for the headline metric, `line` for trends, `sleep` and
   `workouts` when relevant). If there is no data yet, still save widgets for the goal metrics — they fill in after the
   first sync. Then set `onboardingStage` to `done`.

## Skills

The default app skill surface is intentionally small. Promotion, learning,
translation, changelog, provider, and release workflows are optional; enable
the matching skill only when this app actually uses that workflow. The
`docs-search` action reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the active page/selection is
  unclear.

For a custom app, keep `server/plugins/config.ts` aligned with the product
brand. Its `app.name` is used in transactional emails, and its optional
`app.logoUrl` can point to an absolute HTTPS logo URL.

## Application State

- `navigation` describes the current view, and on a dashboard its `dashboardId`. The default view is `dashboard`:
  `/home` opens the most recently updated dashboard; `/` opens the shared sign-in/signup page.
- View `data` is `/data` (sources, every metric with records) and `/data/:key` (one metric or `sleep` / `workouts` /
  `meals` expanded: sources, conflicts, coverage, raw rows, export). View `plans` is still an empty page.
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
