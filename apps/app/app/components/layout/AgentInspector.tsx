import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";

import { dashboardIdFromPath } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

/** The coach panel, open by default on desktop. On a dashboard route the thread is scoped to that dashboard: one chat per dashboard, managed by the framework. */
export function AgentInspector({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const t = useT();
  const dashboardId = dashboardIdFromPath(pathname);
  // Same query key as the dashboard route, so this is a cache read, not a second request.
  const dashboard = useActionQuery("get-dashboard", { dashboardId } as never, { enabled: Boolean(dashboardId) });
  const label = (dashboard.data as { title?: string } | undefined)?.title;
  const scope = useMemo(
    () => (dashboardId ? { type: "vitls-dashboard", id: dashboardId, ...(label ? { label } : {}) } : null),
    [dashboardId, label],
  );

  return (
    <AgentSidebar
      position="right"
      defaultOpen
      storageKey="chat"
      browserTabId={TAB_ID}
      scope={scope}
      isolateHistoryByScope
      showTabBar={false}
      showModelSelector={false}
      thinkingDisplay="hidden"
      emptyStateText={t("chat.inspectEmptyState")}
      agentPageHref="/settings/agent"
      suggestions={[
        t("chat.inspectSuggestionCapabilities"),
        t("chat.inspectSuggestionHello"),
        t("chat.inspectSuggestionAction"),
      ]}
    >
      {children}
    </AgentSidebar>
  );
}
