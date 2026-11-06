# Design: top bar instead of the sidebar, dashboards as horizontal tabs

Date: 2026-10-10. Status: approved in chat. Builds on `2026-10-10-dashboard-first-chat-design.md`.
Reference: a Dribbble health dashboard (dark shell, pill navigation top-left, theme switch / avatar top-right,
"Chat Bot AI" button at the page level).

## 1. Intent

The left sidebar goes away. A top bar carries the app navigation (Dashboards, Data, Plans) on the left and the
theme switch, search and the user menu on the right. Dashboards are horizontal tabs under the top bar with a
"+" to add one; the row also holds a "Chat with coach" button that opens the coach panel. Data and Plans are
placeholder pages for now (user decision 2026-10-10: "data a plans nechaj zatiaľ prázdne").

Success: no left sidebar on any route; every former sidebar capability (switch/create/rename/archive dashboard,
theme, search, user/org menu, settings) is reachable from the top bar or the dashboard tabs; the mobile hamburger
and sheet are gone; the app has fewer lines.

## 2. Framework pieces reused

| Need | Reused |
| --- | --- |
| User / org dropdown | `OrgSwitcher compact` (toolkit `app/org`): avatar trigger with workspace, invitations, settings, sign-out |
| Search | `openCommandMenu` (toolkit `app/shared`) and the existing `CommandMenu` in `root.tsx` |
| Open the coach panel | `focusAgentChat()` (toolkit `app/chat`): opens the `AgentSidebar` and focuses the composer |
| Page titles set by toolkit pages | `HeaderActionsProvider` stays in `Layout` (`/database`, `/observability` call `useSetPageTitle`) |
| Rename / archive menu | `DropdownMenu` from `components/ui` |
| Log value modal | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogTrigger` from `@agent-native/toolkit/ui/dialog` |

## 3. Changes

### 3.1 `TopBar.tsx` (new, `app/components/layout/`)
Row, 56 px, page background, no glass: logo (link to `/home`), a pill `nav` with Dashboards (`/home`, active on
`/home` and `/dashboard/*`), Data (`/data`), Plans (`/plans`); right group: theme button, search button (both
moved from `Sidebar.tsx`), `OrgSwitcher compact currentAppId="chat"`. The nav scrolls horizontally on narrow
screens. Rendered on every route except Settings (which owns its chrome, unchanged).

### 3.2 `DashboardTabs.tsx` (new, `app/components/dashboard/`)
Rendered by the dashboard route above the page header. `list-dashboards` → one tab per board (link to
`/dashboard/:id`, active state from the route). The active tab carries a `⋯` menu: Rename (inline input, Enter
saves through `save-dashboard` with the current config and `expectedUpdatedAt`, Escape cancels), Archive
(`archive-dashboard`, then navigate to the next tab; errors toast). After the tabs a "+" button
(`create-dashboard`, navigate to it). Right side: "Chat with coach" button → `focusAgentChat()`.
The dashboard page header loses its icon toggle (`AgentToggleButton`); "Log value" and "Ask the coach to change
it" stay.

### 3.3 "Log value" opens a modal
`LogValueSheet.tsx` becomes `LogValueDialog.tsx`: same form, same action, but a centered `Dialog` from
`@agent-native/toolkit/ui/dialog` instead of the side `Sheet` (user request 2026-10-10). `components/ui/sheet.tsx`
then has no importer and is deleted.

### 3.4 Routes
`data.tsx`, `plans.tsx`: title meta and a centered `pages.comingSoon` text. `use-navigation-state.ts` maps
`/data` → view `data`, `/plans` → view `plans` (and back for `navigate`).

### 3.5 `Layout.tsx`
Keeps `HeaderActionsProvider` and `AgentInspector`. Loses the sidebar, the collapse state and storage key, the
mobile `Sheet`, the hamburger rows, `routeOwnsToolbar` and the glass `pt-12`. Content = `TopBar` (unless
Settings) + `main`.

### 3.6 Deleted
`Sidebar.tsx`, `Header.tsx`, `global.css` rules for `.chat-sidebar-*`, `.agent-layout-left-drawer`,
`.chat-layout-shell` and the `--chat-sidebar-*` variables. `components/ui/sheet.tsx` (after 3.3) and `hover-card.tsx` (only the sidebar used it).

### 3.7 i18n
New keys in all 13 catalogs: `navigation.data`, `navigation.plans`, `navigation.chatWithCoach`,
`pages.comingSoon`. Keys the template owns (`navigation.collapseSidebar`, `expandSidebar`, `openNavigation`,
`navigationDescription`, `chat.*`) stay even when unused: the catalog test requires `en-US ⊇ template`.
`navigation.dashboardOptions`, `renameDashboard`, `archiveDashboard`, `newDashboard`, `dashboards` are reused.

### 3.8 Coach instructions
`AGENTS.md` Application State: views `data` and `plans` exist (empty pages); nothing else changes.

## 4. Entropy ledger (estimate)

| | lines |
| --- | --- |
| Deleted: `Sidebar.tsx` (≈225), `Header.tsx` (62), Layout sidebar/sheet/hamburger (≈70), sidebar CSS (≈60), `sheet.tsx` + `hover-card.tsx` if unused (≈150) | ≈ −570 |
| Added: `TopBar.tsx` (≈80), `DashboardTabs.tsx` (≈130), `data.tsx` + `plans.tsx` (≈30), nav-state cases (6), 4 keys × 13 | ≈ +300 |
| Net | ≈ −270 |

Mindset: simplicity vs easy. The easy path keeps the sidebar component and hides it; the simple path has one
navigation surface (top bar) and one dashboard-switching surface (tabs), nothing duplicated.

## 5. Open points

- Mobile: no hamburger; the pill nav and the tabs scroll horizontally. Accepted.
- The `⋯` menu lives only on the active tab, so renaming another dashboard means opening it first. Accepted
  (fewer controls on screen; matches the reference).
- Data and Plans content: separate specs later.
