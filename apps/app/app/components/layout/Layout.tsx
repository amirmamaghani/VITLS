import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell/header-actions";
import { isSettingsPathname } from "@agent-native/toolkit/app/settings";
import { lazy, Suspense } from "react";
import { useLocation } from "react-router";

import { cn } from "@/lib/utils";

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
      <main className={cn("agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain", !settingsOwnsChrome && "pt-[6.5rem] sm:pt-14")}>{children}</main>
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
