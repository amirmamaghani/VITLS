import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
  dashboardId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname }) => navigationStateForPath(pathname),
    getCommandPath: (command) => routerPath(command.path || pathForCommand(command)),
  });
}

export function navigationStateForPath(pathname: string): NavigationState {
  const dashboardId = dashboardIdFromPath(pathname);
  return { view: viewForPath(pathname), path: appPath(pathname), ...(dashboardId ? { dashboardId } : {}) };
}

/** `/dashboard/:dashboardId` → the id; null elsewhere. */
export function dashboardIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/([^/]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!).trim() || null;
  } catch {
    return null;
  }
}

function viewForPath(pathname: string): string {
  if (pathname.startsWith("/dashboard") || pathname === "/home") return "dashboard";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/data")) return "data";
  if (pathname.startsWith("/plans")) return "plans";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/settings/agent") || pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/settings") || pathname.startsWith("/team")) return "settings";
  return "dashboard";
}

function pathForView(view?: string): string {
  switch (view) {
    case "database":
      return "/database";
    case "data":
      return "/data";
    case "plans":
      return "/plans";
    case "extensions":
      return "/extensions";
    case "observability":
      return "/observability";
    case "agent":
      return "/settings/agent";
    case "settings":
      return "/settings";
    case "team":
      return "/settings/organization";
    default:
      return "/home";
  }
}

export function pathForCommand(command: { view?: string; dashboardId?: string }): string {
  const dashboardId = command.dashboardId?.trim();
  if ((command.view === "dashboard" || !command.view) && dashboardId) return `/dashboard/${encodeURIComponent(dashboardId)}`;
  return pathForView(command.view);
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}
