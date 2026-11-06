import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { callAction, useDbSync } from "@agent-native/core/client/hooks";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { getLocaleInitScript, useLocale, useT } from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/theme";
import { AppProviders } from "@agent-native/toolkit/app/providers";
import { useCommandMenuShortcut } from "@agent-native/toolkit/app/shared";
import { CommandMenu } from "@agent-native/toolkit/app/shared";
import { IconHierarchy2, IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { ShellBridge } from "@/components/ShellBridge";
import { AppSkeleton } from "@/components/layout/AppSkeleton";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { APP_TITLE } from "@/lib/app-config";
import "@/lib/register-chat-renderers";
import "virtual:agent-native-theme.css";
import { TAB_ID } from "@/lib/tab-id";

import { appLocales, i18nCatalog, supportedLocales } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "app",
    template: "chat",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript({ supportedLocales, localeMetadata: appLocales });

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <meta name="theme-color" content="#18181B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function DbSyncSetup() {
  const qc = useQueryClient();
  const { preference, setPreference } = useLocale();
  useNavigationState();
  useDbSync({
    queryClient: qc,
    ignoreSource: TAB_ID,
    // The coach switches the interface language with set-localization-preference; the i18n provider only reads the
    // stored preference on mount, so re-read it when that tool completes instead of waiting for a reload.
    onEvent: (event: { source?: string; key?: string }) => {
      if (event.source !== "action" || event.key !== "set-localization-preference") return;
      void callAction("get-localization-preference", undefined, { method: "GET" }).then((value) => {
        const locale = (value as { locale?: string } | undefined)?.locale;
        if (locale && locale !== preference) void setPreference(locale);
      });
    },
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  const location = useLocation();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        chatStorageKey="chat"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          {!location.pathname.startsWith("/dashboard") && location.pathname !== "/home" ? (
            <CommandMenu.Item onSelect={() => navigate("/home")}>
              {t("navigation.dashboards")}
            </CommandMenu.Item>
          ) : null}
          <CommandMenu.Item
            onSelect={() => navigate("/settings/agent")}
            keywords={[
              "agent",
              "context",
              "files",
              "connections",
              "jobs",
              "access",
            ]}
          >
            <IconHierarchy2 size={16} />
            {t("settings.openAgentSettings")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        clientOnlyFallback={<AppSkeleton />}
        i18n={{ catalog: i18nCatalog }}
      >
        <DbSyncSetup />
        <ShellBridge />
        <AppContent />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/toolkit/app/shared/ErrorBoundary";
