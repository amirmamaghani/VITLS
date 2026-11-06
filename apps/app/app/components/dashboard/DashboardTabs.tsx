import { callAction, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { IconDotsVertical, IconMessage, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { LogValueDialog } from "@/components/dashboard/LogValueDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type DashboardSummary = { id: string; title: string; updatedAt: string };

const TAB =
  "flex items-center gap-1 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
                className={cn(TAB, "bg-background px-4 py-1.5 text-foreground outline-none")}
                onBlur={(event) => void handleRename(board.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditing(null);
                }}
              />
            );
          }
          return (
            <div key={board.id} className={cn(TAB, active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              <Link
                to={`/dashboard/${encodeURIComponent(board.id)}`}
                role="tab"
                aria-selected={active}
                className="rounded-full px-4 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {board.title}
              </Link>
              {active ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("navigation.dashboardOptions", { title: board.title })}
                      className="me-1 flex size-7 items-center justify-center rounded-full hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
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
        <button
          type="button"
          onClick={() => void handleNew()}
          aria-label={t("navigation.newDashboard")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconPlus className="size-4" strokeWidth={1.8} />
        </button>
      </div>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <LogValueDialog />
        <Button variant="outline" className="gap-2 rounded-full" onClick={focusAgentChat} aria-label={t("navigation.chatWithCoach")}>
          <IconMessage className="size-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t("navigation.chatWithCoach")}</span>
        </Button>
      </div>
    </div>
  );
}
