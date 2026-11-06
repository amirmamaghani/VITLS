# Top Bar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left sidebar with a top bar (Dashboards / Data / Plans, theme, search, user menu) and show dashboards as horizontal tabs with "+" and a "Chat with coach" button.

**Architecture:** One navigation surface (`TopBar`, rendered by `Layout` on every non-settings route) and one dashboard-switching surface (`DashboardTabs`, rendered by the dashboard route). The coach panel stays the toolkit `AgentSidebar`; "Chat with coach" calls the toolkit's `focusAgentChat()`. Data and Plans are placeholder routes. Sidebar, Header, mobile sheet and their CSS are deleted.

**Tech Stack:** `@agent-native/toolkit` (`OrgSwitcher`, `openCommandMenu`, `focusAgentChat`, `DropdownMenu`), React Router v8, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-top-bar-layout-design.md`

All paths are relative to `apps/app`; run commands from `apps/app`. Commit only the files each task names (the tree holds unrelated uncommitted changes).

## Global Constraints

- The catalog test must stay green: template-owned keys stay (`navigation.collapseSidebar`, `expandSidebar`, `openNavigation`, `navigationDescription`, `navigation.chat`, all `chat.*`); new keys go into all 13 `app/i18n/*.ts` (not `*.chrome.ts`) in the same task, sk/cs by hand.
- Settings routes keep their own chrome: `isSettingsPathname(pathname)` → no `TopBar`.
- `HeaderActionsProvider` stays in `Layout` (`/database` and `/observability` call `useSetPageTitle`).
- No `node_modules` edits. Net lines must go down (spec estimate ≈ −270).
- No new abstraction beyond `TopBar` and `DashboardTabs`.

## Review Focus

1. Narrow viewport (360 px): the pill nav and the tab row scroll horizontally; nothing overflows the page width and the "Chat with coach" button stays reachable. (Manual check, Task 6.)
2. Renaming to an empty or whitespace title: nothing is saved, the tab keeps its title. (Covered by the `trim()` guard in Task 4; manual check in Task 6.)
3. Archiving from the tab of the only dashboard: 409 toast, tab stays. (Server test exists from the previous plan; manual check in Task 6.)
4. `/database`, `/observability`, `/extensions` after the change: the top bar renders above them and their own toolbars still work (they no longer get a hamburger row). (Manual check, Task 6.)
5. Keyboard: the active tab's `⋯` menu and the inline rename are reachable by keyboard (Enter saves, Escape cancels). (Manual check, Task 6.)

---

### Task 1: Views `data` and `plans` in navigation state, placeholder routes

**Files:**
- Modify: `app/hooks/use-navigation-state.ts` (`viewForPath`, `pathForView`)
- Modify: `app/hooks/use-navigation-state.test.ts`
- Create: `app/routes/data.tsx`, `app/routes/plans.tsx`
- Modify: `app/i18n/*.ts` (13 files, not `*.chrome.ts`): `pages.comingSoon`, `navigation.data`, `navigation.plans`, `navigation.chatWithCoach`

**Interfaces:**
- Produces: views `"data"` and `"plans"` in `NavigationState.view` and `navigate --view data|plans`; i18n keys used by Tasks 3 and 4.

- [ ] **Step 1: Extend the navigation test**

In `app/hooks/use-navigation-state.test.ts` add to the `describes a dashboard route for the agent` test:

```ts
    expect(navigationStateForPath("/data")).toEqual({ view: "data", path: "/data" });
    expect(navigationStateForPath("/plans")).toEqual({ view: "plans", path: "/plans" });
```

and to `maps navigate commands to paths`:

```ts
    expect(pathForCommand({ view: "data" })).toBe("/data");
    expect(pathForCommand({ view: "plans" })).toBe("/plans");
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm vitest --run app/hooks/use-navigation-state.test.ts`
Expected: FAIL, `expected { view: 'dashboard', … } to deeply equal { view: 'data', … }`.

- [ ] **Step 3: Add the views**

In `viewForPath` add these two lines directly AFTER the `/database` line (`"/database".startsWith("/data")` is true, so `/database` must be matched first):

```ts
  if (pathname.startsWith("/data")) return "data";
  if (pathname.startsWith("/plans")) return "plans";
```

Final order: `/dashboard|/home` → `/database` → `/data` → `/plans` → `/extensions` → `/observability` → agent → settings → default.

In `pathForView` add cases:

```ts
    case "data":
      return "/data";
    case "plans":
      return "/plans";
```

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm vitest --run app/hooks/use-navigation-state.test.ts` → PASS (3 tests).

- [ ] **Step 5: i18n keys**

Add to each of the 13 catalogs (insert alphabetically into `navigation` and `pages`):

| file | navigation.data | navigation.plans | navigation.chatWithCoach | pages.comingSoon |
| --- | --- | --- | --- | --- |
| en-US | Data | Plans | Chat with coach | Coming soon. |
| sk-SK | Dáta | Plány | Chat s coachom | Pripravujeme. |
| cs-CZ | Data | Plány | Chat s koučem | Připravujeme. |
| de-DE | Daten | Pläne | Mit dem Coach chatten | Demnächst. |
| es-ES | Datos | Planes | Chatear con el coach | Próximamente. |
| fr-FR | Données | Plans | Discuter avec le coach | Bientôt disponible. |
| pt-BR | Dados | Planos | Conversar com o coach | Em breve. |
| ja-JP | データ | プラン | コーチとチャット | 近日公開。 |
| ko-KR | 데이터 | 플랜 | 코치와 채팅 | 준비 중입니다. |
| zh-CN | 数据 | 计划 | 与教练聊天 | 即将推出。 |
| zh-TW | 資料 | 計畫 | 與教練聊天 | 即將推出。 |
| ar-SA | البيانات | الخطط | الدردشة مع المدرب | قريبًا. |
| hi-IN | डेटा | योजनाएँ | कोच से चैट करें | जल्द आ रहा है। |

Run: `pnpm vitest --run app/i18n/catalogs.test.ts` → PASS.

- [ ] **Step 6: Placeholder routes**

`app/routes/data.tsx`:

```tsx
import { useT } from "@agent-native/core/client/i18n";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Data - ${APP_TITLE}` }];
}

export default function DataRoute() {
  const t = useT();
  return <div className="flex h-full items-center justify-center px-6 py-6 text-sm text-muted-foreground">{t("pages.comingSoon")}</div>;
}
```

`app/routes/plans.tsx`: identical with `Plans - ${APP_TITLE}` and `PlansRoute`.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck` → clean.

```bash
git add app/hooks/use-navigation-state.ts app/hooks/use-navigation-state.test.ts app/routes/data.tsx app/routes/plans.tsx app/i18n/*.ts
git commit -m "feat(app/nav): data and plans views with placeholder pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `TopBar` replaces the sidebar and the header

**Files:**
- Create: `app/components/layout/TopBar.tsx`
- Modify: `app/components/layout/Layout.tsx` (rewrite)
- Delete: `app/components/layout/Sidebar.tsx`, `app/components/layout/Header.tsx`, `app/components/ui/hover-card.tsx`
- Modify: `app/global.css` (remove sidebar rules and variables)
- Modify: `app/root.tsx` (command menu item "Dashboards" stays; nothing else)

**Interfaces:**
- Produces: `TopBar()` with no props; `Layout({ children })` unchanged signature.
- Consumes: i18n keys from Task 1.

- [ ] **Step 1: Write `TopBar.tsx`**

```tsx
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared/AgentNativeIcon";
import { IconMoon, IconSearch, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Link, useLocation } from "react-router";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/home", key: "navigation.dashboards", isActive: (p: string) => p === "/home" || p.startsWith("/dashboard") },
  { to: "/data", key: "navigation.data", isActive: (p: string) => p.startsWith("/data") && !p.startsWith("/database") },
  { to: "/plans", key: "navigation.plans", isActive: (p: string) => p.startsWith("/plans") },
] as const;

const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** App chrome: pill navigation on the left, theme / search / account on the right. Settings pages own their own chrome. */
export function TopBar() {
  const t = useT();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 lg:px-6">
      <Link to="/home" aria-label={APP_TITLE} className="flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <AgentNativeIcon aria-hidden="true" className="h-3.5 w-6 text-foreground" />
      </Link>
      <nav aria-label={t("navigation.navigation")} className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-card p-1">
        {NAV.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t("root.toggleTheme")} className={ICON_BUTTON}>
              {/* Icon follows the class-based theme in CSS, so SSR and hydration always agree. */}
              <IconMoon className="size-4 dark:hidden" strokeWidth={1.8} />
              <IconSun className="hidden size-4 dark:block" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("root.toggleTheme")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={openCommandMenu} aria-label={t("root.commandSearch")} className={ICON_BUTTON}>
              <IconSearch className="size-4" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("root.commandSearch")}</TooltipContent>
        </Tooltip>
        <OrgSwitcher compact currentAppId="chat" className="size-9 rounded-full bg-transparent p-0 hover:bg-accent" />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Rewrite `Layout.tsx`**

```tsx
import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell/header-actions";
import { isSettingsPathname } from "@agent-native/toolkit/app/settings";
import { lazy, Suspense } from "react";
import { useLocation } from "react-router";

import { TopBar } from "./TopBar";

const AgentInspector = lazy(() =>
  import("./AgentInspector").then((module) => ({ default: module.AgentInspector })),
);

/** App shell: top bar + page, with the coach panel on the right. Settings brings its own chrome and renders full width. */
export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const settingsOwnsChrome = isSettingsPathname(pathname);
  const contentFrame = (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {settingsOwnsChrome ? null : <TopBar />}
      <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell chat-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        <Suspense fallback={contentFrame}>
          <AgentInspector>{contentFrame}</AgentInspector>
        </Suspense>
      </div>
    </HeaderActionsProvider>
  );
}
```

- [ ] **Step 3: Delete the sidebar, header and hover card**

```bash
git rm app/components/layout/Sidebar.tsx app/components/layout/Header.tsx app/components/ui/hover-card.tsx
```

Run: `rg -n "hover-card|components/layout/Header|components/layout/Sidebar" app` → no output.

- [ ] **Step 4: CSS**

In `app/global.css`:
- delete the three `--chat-sidebar-*` variables (lines near 27-29);
- in `.chat-layout-shell { … }` delete the `--agent-layout-left-drawer-expanded-width` line (keep the `--agent-native-lower-surface` line);
- delete the rule `.agent-layout-shell .agent-layout-left-drawer > :where(.border-e, .border-r):first-child { … }` and its comment;
- delete every `.chat-sidebar-history…` rule (the block from `.chat-sidebar-history .an-chat-history__list` through the last `.chat-sidebar-history.an-chat-history--rail … .an-chat-history-row__button { … }`).

Run: `rg -n "chat-sidebar|left-drawer" app` → no output.

- [ ] **Step 5: Typecheck, tests, commit**

Run: `pnpm typecheck && pnpm vitest --run` → clean, all pass.

```bash
git add app/components/layout/TopBar.tsx app/components/layout/Layout.tsx app/global.css
git commit -m "feat(app/layout): top bar with pill navigation replaces the sidebar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git rm` staged the deletions.)

---

### Task 3: Dashboard tabs with "+" and "Chat with coach"

**Files:**
- Create: `app/components/dashboard/DashboardTabs.tsx`
- Modify: `app/routes/dashboard.$dashboardId.tsx`

**Interfaces:**
- Consumes: `list-dashboards`, `create-dashboard`, `save-dashboard`, `archive-dashboard`, `get-dashboard` (GET) actions; i18n keys `navigation.dashboards`, `newDashboard`, `renameDashboard`, `archiveDashboard`, `dashboardOptions`, `chatWithCoach`.
- Produces: `DashboardTabs()` with no props, reads the active id from the route.

- [ ] **Step 1: Write `DashboardTabs.tsx`**

```tsx
import { callAction, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { IconDotsVertical, IconMessage, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type DashboardSummary = { id: string; title: string; updatedAt: string };

const TAB =
  "flex items-center gap-1 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One tab per dashboard (each is one coach chat), "+" to add one, and the way into the coach panel. */
export function DashboardTabs() {
  const t = useT();
  const navigate = useNavigate();
  const { dashboardId: activeId = "" } = useParams();
  const boards = useActionQuery("list-dashboards", {} as never);
  const create = useActionMutation("create-dashboard");
  const save = useActionMutation("save-dashboard");
  const archive = useActionMutation("archive-dashboard");
  const [editing, setEditing] = useState<string | null>(null);
  const items = (boards.data as DashboardSummary[] | undefined) ?? [];
  const open = (id: string) => navigate(`/dashboard/${encodeURIComponent(id)}`);

  const fail = (error: unknown) => {
    const failure = error as Error & { actionMessage?: string };
    toast.error(failure.actionMessage ?? failure.message ?? String(error));
  };
  const handleNew = async () => {
    try {
      const created = (await create.mutateAsync({ title: t("navigation.newDashboard") } as never)) as { id: string };
      open(created.id);
    } catch (error) {
      fail(error);
    }
  };
  const handleRename = async (id: string, title: string) => {
    setEditing(null);
    const next = title.trim();
    if (!next) return;
    try {
      // Rename is a save with the same widgets: the store keeps title and config together.
      const current = (await callAction("get-dashboard", { dashboardId: id } as never, { method: "GET" })) as { config: unknown; updatedAt: string };
      await save.mutateAsync({ dashboardId: id, title: next, config: current.config, expectedUpdatedAt: current.updatedAt } as never);
    } catch (error) {
      fail(error);
    }
  };
  const handleArchive = async (id: string) => {
    try {
      await archive.mutateAsync({ dashboardId: id } as never);
      const next = items.find((board) => board.id !== id);
      if (id === activeId) navigate(next ? `/dashboard/${encodeURIComponent(next.id)}` : "/home");
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div role="tablist" aria-label={t("navigation.dashboards")} className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-card p-1">
        {items.map((board) => {
          const active = board.id === activeId;
          if (active && editing === board.id) {
            return (
              <input
                key={board.id}
                autoFocus
                defaultValue={board.title}
                maxLength={80}
                aria-label={t("navigation.renameDashboard")}
                className={cn(TAB, "bg-background text-foreground outline-none")}
                onBlur={(event) => void handleRename(board.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditing(null);
                }}
              />
            );
          }
          return (
            <div key={board.id} className={cn(TAB, "p-0", active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              <Link to={`/dashboard/${encodeURIComponent(board.id)}`} role="tab" aria-selected={active} className="rounded-full px-4 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {board.title}
              </Link>
              {active ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={t("navigation.dashboardOptions", { title: board.title })} className="me-1 flex size-7 items-center justify-center rounded-full hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <IconDotsVertical className="size-4" strokeWidth={1.8} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setEditing(board.id)}>{t("navigation.renameDashboard")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleArchive(board.id)}>{t("navigation.archiveDashboard")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        })}
        <button type="button" onClick={() => void handleNew()} aria-label={t("navigation.newDashboard")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <IconPlus className="size-4" strokeWidth={1.8} />
        </button>
      </div>
      <Button variant="outline" className="ms-auto shrink-0 rounded-full" onClick={focusAgentChat}>
        <IconMessage className="size-4" strokeWidth={1.8} />
        {t("navigation.chatWithCoach")}
      </Button>
    </div>
  );
}
```

Check that `DropdownMenuItem` from `@agent-native/toolkit/ui/dropdown-menu` accepts `onSelect` (it is Radix-based; `rg -n "onSelect" node_modules/@agent-native/toolkit/dist/ui/dropdown-menu.d.ts` or rely on the Radix types). If the `Button` component does not lay out an icon and text with a gap, add `className="… gap-2"`.

- [ ] **Step 2: Mount it in the dashboard route**

In `app/routes/dashboard.$dashboardId.tsx`:
- replace `import { AgentToggleButton } from "@agent-native/toolkit/app/chat";` with `import { DashboardTabs } from "@/components/dashboard/DashboardTabs";`
- wrap the three return branches (error, empty, filled) so the tabs always render first. Replace the body after `const dashboard = …` / `update` with:

```tsx
  const body = (() => {
    if (query.error) {
      const error = query.error as Error & { status?: number; actionMessage?: string };
      return <p className="py-16 text-center text-sm text-muted-foreground">{error.status === 404 ? t("pages.dashboardNotFound") : (error.actionMessage ?? error.message)}</p>;
    }
    if (!dashboard) return <div aria-busy="true" />;
    const items = dashboard.config.widgets;
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">Your coach builds this dashboard from your goals and data.</p>
          <div className="flex gap-2">
            <Button onClick={() => askCoach("Build my dashboard from my goals and the data I have.")}>Ask the coach</Button>
            <LogValueSheet />
          </div>
        </div>
      );
    }
    // Keep the existing `remove`, `setRange` and `move` definitions here verbatim (they close over `items` and `update`).
    return (
      <>
        <DashboardHeader title={dashboard.title} />
        {/* the existing groupSections(items).map(...) block, verbatim */}
      </>
    );
  })();

  return (
    // One 24 px rhythm: page inset = gap = card padding. The page owns its header (no shell top bar, see Layout).
    <div className="flex max-w-6xl flex-col gap-8 px-6 py-6">
      <DashboardTabs />
      {body}
    </div>
  );
```

- in `DashboardHeader` remove `<AgentToggleButton />` (the "Chat with coach" button in the tab row replaces it).

- [ ] **Step 3: Typecheck, tests, commit**

Run: `pnpm typecheck && pnpm vitest --run` → clean.

```bash
git add app/components/dashboard/DashboardTabs.tsx 'app/routes/dashboard.$dashboardId.tsx'
git commit -m "feat(app/dashboard): dashboards as tabs with add, rename, archive and chat with coach

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: "Log value" as a modal dialog

**Files:**
- Create: `app/components/dashboard/LogValueDialog.tsx` (moved from `LogValueSheet.tsx`)
- Delete: `app/components/dashboard/LogValueSheet.tsx`, `app/components/ui/sheet.tsx`
- Modify: `app/routes/dashboard.$dashboardId.tsx` (two usages)

**Interfaces:**
- Produces: `LogValueDialog()` with no props (same as `LogValueSheet` before).

- [ ] **Step 1: Move and convert**

```bash
git mv app/components/dashboard/LogValueSheet.tsx app/components/dashboard/LogValueDialog.tsx
```

In the moved file replace the sheet import and markup:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@agent-native/toolkit/ui/dialog";
```

```tsx
export function LogValueDialog() {
```

```tsx
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Log value</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log value</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          …form unchanged…
        </form>
      </DialogContent>
    </Dialog>
```

Update the doc comment: "Manual entry modal: the fallback when no tracker provides a value …".

- [ ] **Step 2: Callers and the sheet primitive**

In `app/routes/dashboard.$dashboardId.tsx` replace the import with `import { LogValueDialog } from "@/components/dashboard/LogValueDialog";` and both `<LogValueSheet />` with `<LogValueDialog />`.

```bash
git rm app/components/ui/sheet.tsx
```

Run: `rg -n "LogValueSheet|components/ui/sheet" app` → no output.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm typecheck` → clean.

```bash
git add app/components/dashboard/LogValueDialog.tsx 'app/routes/dashboard.$dashboardId.tsx'
git commit -m "feat(app/dashboard): log value opens a modal dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Coach instructions

**Files:**
- Modify: `AGENTS.md` (Application State section)

- [ ] **Step 1: Edit**

After the `navigation` bullet add:

```md
- Views `data` and `plans` exist as empty pages for now; `navigate` to them only when the user asks for those sections.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(app): data and plans views in the coach's application-state notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Browser verification and entropy ledger

- [ ] **Step 1:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/home` → `200`.
- [ ] **Step 2 (Chrome):**
  1. `/home` → dashboard: top bar with logo, pills Dashboards (active) / Data / Plans, right: theme, search, avatar; no sidebar, no hamburger.
  2. Tab row: one tab per dashboard, active tab filled, `⋯` on the active tab, "+" after the tabs, "Chat with coach" at the right.
  3. "+" → new tab, URL changes. `⋯` → Rename → type "Maratón" → Enter → tab and header update. Escape during rename keeps the old title. Empty title keeps the old title.
  4. "Chat with coach" → the panel opens with the composer focused and the dashboard's chip.
  5. `⋯` → Archive on the active tab → lands on the remaining dashboard. Archive on the last one → toast, tab stays.
  6. Data and Plans → placeholder text; pill active state follows. `/database` and `/observability` render under the top bar.
  7. Theme button toggles; search opens the command menu; avatar opens the account menu with Settings.
  7b. "Log value" opens a centered modal; Escape and the backdrop close it; saving a weight closes it and the widget updates.
  8. Resize to 360 px: pills and tabs scroll horizontally, nothing overflows.
  9. Slovak: "Dáta", "Plány", "Chat s coachom", "Pripravujeme."
- [ ] **Step 3:** `git diff --stat 79664df..HEAD -- apps/app docs | tail -1` → deletions exceed insertions by roughly 250.
- [ ] **Step 4:** `pnpm typecheck && pnpm vitest --run && pnpm agent-native:doctor` → green.
