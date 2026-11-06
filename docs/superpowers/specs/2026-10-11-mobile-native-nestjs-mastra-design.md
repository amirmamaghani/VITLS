# Mobile-Native Architecture: NestJS + Mastra + Expo

**Date:** 2026-10-11  
**Status:** Approved

## Summary

Replace the agent-native full-stack web app (`apps/app`) with a native Expo mobile app and a standalone NestJS + Mastra backend. The web app disappears entirely. All user-facing functionality moves into the mobile app. The server becomes a pure API with no frontend concerns.

## Goals

- All features (dashboard, meals, coaching, chat, food photo, settings) live natively in the mobile app
- No WebView in the companion app
- Clean NestJS backend with Mastra for AI agent orchestration
- BetterAuth for authentication (magic links + Sign in with Apple/Google)
- Genuine native look and feel via `expo-ui` and Reanimated

## Monorepo Structure

```
apps/
  server/          ← new: NestJS + Mastra backend
  companion/       ← expanded: full-featured Expo app
  web/             ← unchanged (Next.js marketing/landing)
  gccli-sync/      ← unchanged; calls /api/devices/redeem and /api/ingest/v1/batches
  app/             ← deleted after migration is complete

packages/
  health-ingest/   ← unchanged; already shared by server, companion, gccli-sync
  dashboard/       ← new, from apps/app/shared/: widgetSchema (24 kinds + section),
                     DashboardConfig, WIDGET_CATALOG, widget-data param builders
  physiology/      ← unchanged
  typescript-config/ ← unchanged
```

`apps/app` stays alive during migration and is deleted once all routes and screens have been ported.

**Route contract:** the new server keeps the paths `/api/devices/*` and `/api/ingest/v1/batches` unchanged so `gccli-sync` and already-installed companion builds keep working without a coordinated release.

## Backend: NestJS + Mastra

### NestJS Modules

```
apps/server/src/
  auth/        ← BetterAuth adapter: magic links, Sign in with Apple/Google
  devices/     ← device pairing, Expo push notifications (no Web Push: there is no web client)
  ingest/      ← health data batch endpoint from companion and gccli-sync
  dashboard/   ← agent-composed boards: CRUD + revisions + restore (replaces
                 agent-native createDashboardStorage; tables vitls_dashboards,
                 vitls_dashboard_revisions ported); widget data queries; data catalog; CSV export
  meals/       ← food search (Open Food Facts), meal logging, photo analysis
  coach/       ← Mastra coaching agent: readouts, training plans; morning-readout cron
  chat/        ← Mastra chat agent: SSE streaming endpoint
  exercises/   ← exercise DB, search
  mail/        ← ported smtp-relay / Resend sender (today an agent-native plugin)
  common/      ← Drizzle DB, AuthGuard, shared pipes
```

Each module owns: controller (HTTP endpoints) + service (business logic). Mastra lives only inside `coach/` and `chat/` — other modules have no AI dependency.

### Auth

BetterAuth mounted as NestJS middleware at `/auth/*`. All other routes protected via `AuthGuard` that validates the BetterAuth session. Magic links sent through the `mail/` module. Apple and Google sign-in added as BetterAuth social providers.

### Data Sharing & Roles

A user (the data owner, e.g. a patient) can grant another account (e.g. their doctor) **read-only** access to their data. This is grant-based, not tenant-based: there is no agent-native org federation. A `data_shares` table holds `(owner_email, grantee_email, role, created_at, revoked_at)` with `role` in `{ read }` for now (write/coach roles can be added later).

Every read endpoint and agent read tool resolves the effective owner through an authorization layer: a request for `owner_email = X` is allowed when the session user is `X`, or when a live `data_shares` row grants the session user a sufficient role on `X`. Writes (ingest, logging, dashboard save) are owner-only — a `read` grantee cannot mutate. Device tokens are unaffected: they are write-only and always scoped to the owner who paired them. The doctor sees a read-only view of the owner's boards, metrics, and readouts; the sharing UI (grant, list, revoke) lives in settings. Specified in its own plan, not Plan #1.

### Scheduling

Today the morning readout is an agent-native scheduled job (`jobs/morning-readout.md`) built from the coach profile's `readoutTime` (local `HH:MM`) and `timezone` (IANA). Users are worldwide, so "morning" is a local wall-clock time, never a UTC time.

The new server keeps both fields in the coach profile and uses `@nestjs/schedule`:

- One cron tick per minute. For every user with a `readoutTime`, compute the current local date and time in their `timezone` (`Intl.DateTimeFormat`, like `meals.ts` does today).
- Run when local time `>= readoutTime` **and** `last_readout_local_date != today's local date`. The date guard makes it at-most-once per local day (DST fall-back repeats an hour; the second pass is a no-op) and the `>=` makes it catch up (DST spring-forward skips an hour; server downtime; the tick never has to hit the exact minute).
- The run invokes `CoachAgent`, saves the readout, sends an Expo push, then writes `last_readout_local_date`.

The companion sends the device timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on every launch and whenever it changes, so the profile timezone is never unknown and follows the user when they travel. The chat agent's current "timezone unknown — ask during onboarding" fallback goes away.

### Database

Postgres + Drizzle. Schemas from `apps/app/server/db/` are ported directly, stripping only agent-native wrapper imports. No schema changes needed during migration.

### Mastra Integration

Mastra runs as an injectable NestJS service (`MastraModule`, global singleton), not as a standalone server.

```
common/mastra/
  mastra.module.ts   ← global MastraModule, Postgres memory config
  mastra.service.ts  ← Mastra instance, agent registry

coach/
  coach.agent.ts     ← Mastra Agent (morning readout)
  chat.agent.ts      ← Mastra Agent (chat); same tool set, different prompt
  tools/             ← one file per tool, ported 1:1 from today's 22 agent-native actions
```

**Tools (today's `agent-chat.ts` list, kept 1:1):**
health — `get-health`, `get-data-catalog`, `get-health-raw`, `log-health-data`;
nutrition — `search-foods`, `log-meal`, `delete-meal`, `create-food`, plus new `analyze-food-photo`;
dashboards — `list-dashboards`, `create-dashboard`, `archive-dashboard`, `get-dashboard`, `save-dashboard`, `list-dashboard-revisions`, `restore-dashboard-revision`, `show-widget`;
coach — `save-readout`, `get-training-plan`, `save-training-plan`, `search-exercises`;
device — `create-device-pairing`, `manage-notifications`.

**Dynamic dashboards from chat.** This is a core feature, not an admin page. The user asks in chat ("make me a recovery board"); the agent calls `save-dashboard` with a `DashboardConfig` validated by `widgetSchema` from `packages/dashboard` (sections + up to 20 widgets of 24 kinds). `WIDGET_CATALOG` from the same package goes into the agent's system prompt so the model knows every kind and its params. `show-widget` returns one widget config that the chat UI renders inline in the reply. Every save creates a revision; the user can restore from the board or by asking. Behaviour and catalog are specified in `docs/design/04-dashboards.md` and `docs/design/07-widget-catalog.md`; this spec changes only where the code lives, not what it does.

**Memory:** Mastra conversation memory stored in Postgres (same DB). Each user's thread ID is their `userId`. The per-turn `<coach-profile>` context block (today `coachContext()` in `agent-chat.ts`, per `docs/design/03-coach.md`) is injected the same way: the DB is the truth, not the thread.

**Streaming:** `POST /chat` returns the AI SDK UI message stream (SSE) produced by `@mastra/ai-sdk` (`toAISdkStream` → `createUIMessageStreamResponse`); NestJS only pipes it. Nothing custom on the wire. Tool calls, including `show-widget`, arrive as typed stream parts, so no side channel is needed for inline widgets. iOS can chop the stream; the documented workaround is `Content-Type: application/octet-stream`, applied if seen.

**Food photo analysis:** `analyzeFoodPhoto` tool receives base64 image → calls Claude vision API → returns recognized food with macros → agent confirms and logs to DB.

## Mobile App: Expo Companion

### Screens

```
apps/companion/src/app/
  (tabs)/
    index.tsx        ← Boards: tabs over the user's dashboards (today DashboardTabs),
                       default board rendered from its DashboardConfig
    meals.tsx        ← Meal log + food search
    chat.tsx         ← useChat from @ai-sdk/react with DefaultChatTransport over expo/fetch
                       (official AI SDK Expo pattern): message state, streaming, stop,
                       tool parts; show-widget part → native HealthWidget inline.
                       Only bubbles + input are ours, in expo-ui.
    workouts.tsx     ← Workouts, lifts, sessions
    settings.tsx     ← Settings, device pairing, notifications, readout time
  coach/
    readout.tsx      ← Coaching readout detail
    plans.tsx        ← Training plans (today /plans)
  meals/
    log.tsx          ← Manual meal logging
    photo.tsx        ← Camera → agent food analysis → confirm → log
  data/
    index.tsx        ← Health data catalog + CSV export (today /data, /data/:key)
    [key].tsx        ← Metric detail table
  dashboard/
    [id].tsx         ← One board: sections + widgets, range switch, reorder/remove
                       (today WidgetMenu), revision restore, "ask the coach" entry
  auth/
    login.tsx        ← Magic link / Apple / Google via BetterAuth
  components/widgets/
    index.tsx        ← native HealthWidget: HEADERS / BODIES / PARAMS maps keyed by
                       WidgetKind, ported from apps/app/app/components/widgets
    *.tsx            ← one native body per kind (24), charts via Victory Native / Skia
```

### Widgets

The widget registry keeps today's shape: adding a kind means one entry in `widgetSchema` (`packages/dashboard`), one header, one body, one params builder — never a `switch`. Data for a widget comes from `GET /dashboard/widget-data` with the params the builder produces; the server reuses the same builder from `packages/dashboard`, so client and server never disagree on what a widget needs.

Agent-native admin pages (`/database`, `/extensions`, `/observability`, `/team`, `/agent`) are dropped, not ported. `/dashboard/:id` is **not** admin — it is the user-facing board and is ported as `dashboard/[id].tsx`.

### i18n

`apps/app/app/i18n/` holds 14 locale catalogs (plus `*.chrome.ts` variants). They move into `apps/companion/src/i18n/` unchanged; the `i18n-sync` skill keeps targeting the new path. Agents receive the user's locale in their system prompt so readouts and chat answer in the app language.

### Native Look and Feel

- `expo-ui` — components backed by SwiftUI / Jetpack Compose primitives
- `react-native-reanimated 4` (already installed) — 60/120fps animations on UI thread
- `expo-router` native stacks (already installed) — platform-native screen transitions
- `expo-haptics` — correct haptic feedback
- `expo-symbols` — SF Symbols on iOS

WebView is removed entirely. Every screen has a native implementation.

### Preserved from Current Companion

- `health.ios.ts` / `health.android.ts` — HealthKit + Health Connect bridge
- `sync.ts`, `batch.ts` — batch health data ingest
- `push.ts` — Expo push token registration
- `today.ts`, `+native-intent.ts`, `pair.tsx` — already native

### Deleted from Current Companion

- `bridge.ts` and its test — the WebView ↔ PWA message bridge; pairing and sync-now become plain native actions
- `react-native-webview` dependency

## Migration Path

1. **Bootstrap `apps/server`** — NestJS scaffold, Drizzle connection, BetterAuth, `mail/`; port `devices/` and `ingest/` routes first (companion and gccli-sync already call these, same paths)
2. **Port business logic** — `dashboard/`, `meals/`, `exercises/`, `coach/` module by module; companion points at new server once each module is ready
3. **Mastra agents + scheduler** — wire `CoachService` and `ChatService` to Mastra; replace agent-native chat plugin and the morning-readout job resource
4. **Expand companion** — add native screens replacing WebView one at a time; `expo-ui` for all new screens; move i18n catalogs
5. **Delete `apps/app`** — once companion covers all screens and server covers all routes

## Out of Scope

- Apple Watch app (Expo cannot build watchOS targets; separate project if needed later)
- Home screen widgets (iOS/Android; separate native extension if needed later)
- Siri / Shortcuts integration
