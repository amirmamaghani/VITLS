/** Pure chat helpers (kept out of the screen so they unit-test without the RN/@expo/ui runtime). */
export const FALLBACK_DASHBOARD = "default";

/** The first board of GET /api/dashboards, else a constant (the thread is keyed by owner + dashboardId server-side). */
export const pickDashboardId = (boards: { id: string }[] | null | undefined): string => boards?.[0]?.id ?? FALLBACK_DASHBOARD;

/** One chat in the switcher: a (owner, dashboard) thread with its auto-title. */
export type ChatSummary = { dashboardId: string; title: string | null; updatedAt: string | null };

/** Which chat to open: the last one if it still exists, else the most recent; undefined when the user has no chats yet. */
export function pickCurrentChat(threads: ChatSummary[], lastId: string | null | undefined): string | undefined {
  if (lastId && threads.some((t) => t.dashboardId === lastId)) return lastId;
  return threads[0]?.dashboardId;
}

/** The header label for a chat: its stored title, else a default (a brand-new chat has no thread row yet). */
export const chatTitle = (threads: ChatSummary[], id: string | undefined): string => threads.find((t) => t.dashboardId === id)?.title || "New chat";

type Part = { type: string; text?: string; output?: unknown; state?: string; url?: string };

export type ViewPart = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string } | { kind: "image"; url: string };

/** Text parts become text; file parts (photo attachments) become an image; `tool-*` parts become a placeholder card until the native widget registry. */
export function classifyPart(p: Part): ViewPart | null {
  if (p.type === "text") return p.text ? { kind: "text", text: p.text } : null;
  if (p.type === "file") return p.url ? { kind: "image", url: p.url } : null;
  if (!p.type.startsWith("tool-")) return null;
  const out = p.output === undefined ? (p.state ?? "running") : JSON.stringify(p.output);
  return { kind: "tool", name: p.type.slice(5), summary: out.length > 240 ? `${out.slice(0, 240)}…` : out };
}

/** AI SDK v5 throws Error(responseBody) on a non-2xx; our server's 401 body is {error, errorCode:"unauthorized"}. Also matches server-client's Unauthorized. */
export function isUnauthorized(e: unknown): boolean {
  const m = e instanceof Error ? e.message : "";
  if (m === "unauthorized") return true;
  try {
    return (JSON.parse(m) as { errorCode?: string }).errorCode === "unauthorized";
  } catch {
    return false;
  }
}
