# Design: dashboard-first, one chat per dashboard

Date: 2026-10-10. Status: draft for review. Supersedes the "one dashboard per user" decision in
`docs/design/04-dashboards.md` §2 and the chat-first home in `apps/app/CLAUDE.md`.

## 1. Intent

The user owns several dashboards and each dashboard has exactly one conversation with the coach. The
dashboard is the home screen; the chat is a panel beside it. The app never creates, lists, pins,
renames or archives chat threads itself: a thread is an attribute of a dashboard, and the framework
manages it.

Success: after sign-in the user lands on a dashboard with its chat open; a new dashboard gets its own
empty chat; switching dashboards switches the chat; the "new chat" affordances are gone everywhere;
the app has fewer lines and one concept (thread management) less.

Assumptions the user confirmed: dashboard-first (no full-page chat route), and the first dashboard
always exists, so there is never a "no dashboard" state.

## 2. Framework mechanisms reused (nothing new is invented)

| Need | Framework feature | Where it lives |
| --- | --- | --- |
| Chat bound to an entity | `ChatThreadScope { type, id, label }` on `AgentSidebar` with `isolateHistoryByScope` | `@agent-native/toolkit/app/chat` (`AgentSidebar.d.ts`), `@agent-native/core/client/use-chat-threads` |
| No "+" tab / new thread UI | `showTabBar={false}` on `AgentSidebar` | same |
| Thread for a scope created on demand | `MultiTabAssistantChat` creates a thread when the scope has none or the active one is stale | toolkit `MultiTabAssistantChat.js` |
| Many dashboards per owner | `createDashboardStorage` (`list`, `write`, revisions, sharing) | `@agent-native/core/dashboard-storage`; already wired in `server/db/index.ts` |
| Agent knows the current dashboard | `navigation` application state (`useAgentRouteState`, `view-screen`) | `app/hooks/use-navigation-state.ts`, `actions/view-screen.ts` |

Not available in the store API: archiving (`archivedAt` exists as a column and `list()` filters on it, but
there is no `archive()` method). See §5.

## 3. Changes

### 3.1 Data and actions (`apps/app/actions`, `server/db`)

- `dashboardId(owner)` stops being "the" dashboard id. It stays only as the id of the **default
  dashboard** (first one, created on demand) so existing rows keep working without a migration.
- `list-dashboards` (new, GET, readOnly): `dashboardStore.list(ownerAccess(owner))`; when the list is
  empty, writes the default dashboard (`{ id: dashboardId(owner), kind: "health", title: "Dashboard",
  config: EMPTY_DASHBOARD }`) and returns it. This single place guarantees "the first dashboard always
  exists". Returns `{ id, title, updatedAt }[]`.
- `create-dashboard` (new): `{ title }` → `write({ id: "dashboard-" + randomUUID(), kind, title,
  config: EMPTY_DASHBOARD })`. Returns the record. The UI navigates to it; the coach may call it when
  the user asks for a separate board (e.g. "a marathon dashboard").
- `get-dashboard`, `save-dashboard`, `list-dashboard-revisions`, `restore-dashboard-revision`: add
  `dashboardId: z.string()` to the schema. The UI passes it from the route. The coach reads it from
  `view-screen` (`navigation.dashboardId`) and passes it explicitly. `save-dashboard` keeps the
  409 guard; the "one owner per dashboard" note stays true.
- `show-widget`: unchanged (it renders, it does not read a dashboard).
- `archive-dashboard` (new): see §5; a direct `update(dashboards).set({ archivedAt })` scoped by the
  access filter, ~10 lines, with an upstream note asking for `archive()` in the store.

### 3.2 Routes (`apps/app/app/routes`)

- `dashboard.$dashboardId.tsx` replaces `dashboard.tsx`. Same component; the id comes from the route
  param and is passed to every action call.
- `home.tsx` becomes a redirect to the first dashboard: `list-dashboards` → `navigate(/dashboard/<id>)`.
  The `markAgentChatHomeHandoff` / `chat-home-thread.ts` handoff machinery is deleted; there is no
  full-page chat to hand off to.
- `chat.$threadId.tsx` and `app/components/chat/ChatRouteContent.tsx` are deleted. The guided question
  flow lives in the toolkit sidebar already (the sidebar card was the English one noted in
  `BACKLOG.md`; that backlog entry and `docs/upstream/agent-native-guided-question-defaults-not-localized.md`
  stay as the remaining upstream ask).

### 3.3 Application state (`app/hooks/use-navigation-state.ts`)

- `NavigationState` becomes `{ view, path, dashboardId? }`. `threadId` and `threadIdFromPath` are
  removed; `dashboardIdFromPath` reads `/dashboard/:id`.
- `pathForView("dashboard")` with `command.dashboardId` → `/dashboard/<id>`; `"chat" | "home"` → `/home`.
- `actions/navigate.ts`: `threadId` → `dashboardId`.

### 3.4 Layout and sidebars (`app/components/layout`)

- `AgentInspector` receives `scope={{ type: "vitls-dashboard", id, label: title }}`,
  `isolateHistoryByScope`, `showTabBar={false}`, and drops `onFullscreenRequest` (no full page) and
  the handoff props. It is rendered on every non-settings route; outside `/dashboard/:id` the scope is
  `null` (the framework's default behaviour, unchanged).
- `Layout`: `isChatRoute`, the home-handoff hooks and the `agent-chat:open-thread` listener go.
- `Sidebar`: `ChatThreadsSection` (threads list, new chat, archive, rename, pin, relative time) and its
  helpers are deleted together with `lib/sidebar-thread-state.ts` and its test. In their place a
  `DashboardsSection`: `useActionQuery("list-dashboards")`, one `Link` per dashboard (active state from
  the route), and a "New dashboard" button calling `create-dashboard` then navigating. Rename is a
  `save-dashboard` with the new title (the store has no rename; title is part of the record).
- `Header`: page title for `/dashboard/*` is the dashboard title; `/home` entry removed.
- `root.tsx` command menu: "New chat" and "Chat" items removed; "New dashboard" added.

### 3.5 Coach instructions (`apps/app/CLAUDE.md`, skills)

- Coach Tools table: `list-dashboards`, `create-dashboard`, `archive-dashboard`; `get/save-dashboard`
  take `dashboardId` from `view-screen`.
- Onboarding step 8: fill the dashboard the chat belongs to (`navigation.dashboardId`); `navigate` is
  no longer needed because the user is already on it.
- "Application State": default view is `dashboard` at `/home` → first dashboard.
- `docs/design/04-dashboards.md` §2: replace the one-per-user sentence with a pointer to this spec.

### 3.6 i18n

- `chat.guided*` keys (5 × 13 files) and the thread-list keys that only `ChatThreadsSection` used are
  deleted after `rg -n 't\("chat\.'` confirms no caller. New keys: `navigation.dashboards`,
  `navigation.newDashboard`, `navigation.archiveDashboard` in all 13 catalogs (sk/cs by hand).

## 4. Entropy ledger

| | lines |
| --- | --- |
| Deleted: `ChatRouteContent.tsx`, `chat.$threadId.tsx`, `chat-home-thread.ts`, `sidebar-thread-state.ts` + test, `ChatThreadsSection` and helpers, handoff code in `Layout`/`home`, guided i18n keys | ≈ −1 100 |
| Added: `list-dashboards`, `create-dashboard`, `archive-dashboard`, `DashboardsSection`, `dashboardId` plumbing, 3 i18n keys × 13 | ≈ +170 |
| Net | ≈ −930 |

Mindset: *simplicity vs easy*. The easy route is to keep the thread list and add a dashboard filter;
the simple route removes thread management from the app entirely, so "chat" and "dashboard" stop
being intertwined concepts: the dashboard is the thing, the chat is its property.

## 5. Open points and risks

- **Archiving.** The store exposes `archivedAt` through `list()` but no writer. Options: (a) direct
  Drizzle update in `archive-dashboard` (chosen; smallest, uses the store's own access filter), (b) no
  archiving in v1. The upstream note asks for a store method so (a) can be deleted later.
- **Thread growth / rotation (found in review, 2026-10-10).** The toolkit opens a fresh thread in the dashboard's
  scope after 12 h without activity and restores the active thread per device (`localStorage`); earlier threads stay
  in the panel's history (`⋮`). So a dashboard owns one chat *history*, and most mornings start a new thread. The
  app cannot change this without ejecting; `docs/upstream/agent-native-sidebar-new-chat-not-configurable.md` asks
  for a `singleThread` prop. Durable facts go through `save-memory` either way.
- **Existing threads.** Threads created before this change have no scope and will not appear in any
  dashboard's chat. They stay in the database (the framework keeps them); nothing deletes them. The
  current test users can be told to start fresh.
- **Readout and notifications.** `save-readout` and `manage-notifications` are per user, not per
  dashboard; the `readout` widget can sit on any dashboard. Unchanged.
- **Mobile.** The chat becomes the toolkit's slide-over panel on small screens instead of a full page.
  Accepted by the user (dashboard-first).

## 6. Verification

- `pnpm vitest --run` (catalog test, dashboard tests), `pnpm typecheck`, `pnpm agent-native:doctor`.
- Browser: sign in → lands on `/dashboard/<default>`, right panel open with an empty chat; create a
  second dashboard → new empty chat, first chat untouched; switch back → first chat restored; no "+"
  or "New chat" anywhere; coach `view-screen` returns `navigation.dashboardId`; `save-dashboard`
  without `dashboardId` fails validation.
