import { useT } from "@agent-native/core/client/i18n";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { IconMoon, IconSearch, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Link, useLocation } from "react-router";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

import { Wordmark } from "./Wordmark";

const NAV = [
  { to: "/home", key: "navigation.dashboards", isActive: (p: string) => p === "/home" || p.startsWith("/dashboard") },
  { to: "/data", key: "navigation.data", isActive: (p: string) => p.startsWith("/data") && !p.startsWith("/database") },
  { to: "/plans", key: "navigation.plans", isActive: (p: string) => p.startsWith("/plans") },
] as const;

const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * App chrome: logo and pill navigation on the left, theme / search / account on the right. Frosted glass over the
 * scrolling page (main pads its top by the bar height); Settings pages own their own chrome.
 */
export function TopBar() {
  const t = useT();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    // `border-b-[1px]`, not `border-b`: the toolkit forces an opaque surface on layout headers with `.border-b`.
    <header className="glass absolute inset-x-0 top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b-[1px] border-border/60 px-4 py-1.5 sm:h-14 sm:flex-nowrap sm:py-0 lg:px-6">
      <Link
        to="/home"
        aria-label={APP_TITLE}
        className="flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The wordmark in the website's headline font, as outlines. */}
        <Wordmark className="h-[1.0625rem] w-auto" />
      </Link>
      {/* Below `sm` the nav takes its own row (full width); the page pads for both heights (Layout). */}
      <nav aria-label={t("navigation.navigation")} className="order-last flex min-w-0 basis-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1 sm:order-none sm:basis-auto">
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
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label={t("root.toggleTheme")}
              className={ICON_BUTTON}
            >
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
        {/* The coach panel's toggle for every page; on a dashboard the tab row also offers "Chat with coach". */}
        <AgentToggleButton className={ICON_BUTTON} />
        <OrgSwitcher compact currentAppId="chat" className="size-9 rounded-full bg-transparent p-0 hover:bg-accent" />
      </div>
    </header>
  );
}
