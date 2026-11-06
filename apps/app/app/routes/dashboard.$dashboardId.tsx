import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useParams } from "react-router";

import { HealthWidget } from "@/components/widgets";
import { WidgetMenu } from "@/components/widgets/blocks";
import { useUserTimeZone } from "@/components/widgets/coach";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

import { groupSections, type DashboardConfig, type RangeKey } from "../../shared/dashboard";
import { dayOf } from "../../shared/widget-data";
import type { Readout } from "../../server/lib/coach/readout";

export function meta() {
  return [{ title: `Dashboard - ${APP_TITLE}` }];
}

type Dashboard = { title: string; config: DashboardConfig; updatedAt?: string };

const askCoach = (message: string) => sendToAgentChat({ message, submit: false, openSidebar: true });

/** The agent composes this board with save-dashboard; the user can reorder/remove widgets or ask the coach. */
export default function DashboardRoute() {
  const { dashboardId = "" } = useParams();
  const t = useT();
  const query = useActionQuery("get-dashboard", { dashboardId } as never);
  const save = useActionMutation("save-dashboard");
  const dashboard = query.data as Dashboard | undefined;

  const update = (widgets: DashboardConfig["widgets"]) =>
    save.mutate({ dashboardId, title: dashboard!.title, config: { version: 1, widgets }, expectedUpdatedAt: dashboard!.updatedAt } as never);

  const body = (() => {
    if (query.error) {
      const error = query.error as Error & { status?: number; actionMessage?: string };
      return (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {error.status === 404 ? t("pages.dashboardNotFound") : (error.actionMessage ?? error.message)}
        </p>
      );
    }
    if (!dashboard) return <div aria-busy="true" />;
    const items = dashboard.config.widgets;

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">Your coach builds this dashboard from your goals and data.</p>
          <Button onClick={() => askCoach("Build my dashboard from my goals and the data I have.")}>Ask the coach</Button>
        </div>
      );
    }

    // Sections and widgets share one flat list, so moving an item across a heading moves it into the next section.
    const remove = (id: string) => update(items.filter((w) => w.id !== id));
    const setRange = (id: string, range: RangeKey) => update(items.map((w) => (w.id === id && "range" in w ? { ...w, range } : w)));
    const move = (id: string, delta: -1 | 1) => {
      const i = items.findIndex((w) => w.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= items.length) return;
      const next = [...items];
      [next[i], next[j]] = [next[j]!, next[i]!];
      update(next);
    };

    return (
      <>
        <DashboardHeader title={dashboard.title} />
        {groupSections(items).map((group, g) => (
          <section key={group.section?.id ?? `group-${g}`} className="flex flex-col gap-4">
            {group.section && (
              <div className="flex items-center gap-3">
                <h2 className="flex-1 text-xl tracking-tight">{group.section.title}</h2>
                <WidgetMenu label={group.section.title} onMove={(delta) => move(group.section!.id, delta)} onRemove={() => remove(group.section!.id)} />
              </div>
            )}
            {group.widgets.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.widgets.map((widget) => (
                  <HealthWidget key={widget.id} widget={widget} onRemove={() => remove(widget.id)} onMove={(delta) => move(widget.id, delta)} onRange={(range) => setRange(widget.id, range)} />
                ))}
              </div>
            )}
          </section>
        ))}
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
}

/**
 * The coach's greeting for today as the heading (written in the persona's voice by the morning readout), the date above
 * it and the directive below; before today's readout a plain "Hi, <first name>" from the account profile.
 */
function DashboardHeader({ title }: { title: string }) {
  const timeZone = useUserTimeZone();
  const profile = useActionQuery("get-coach-profile", {} as never);
  const readout = (profile.data as { readout?: Readout | null } | undefined)?.readout;
  const account = useActionQuery("get-user-profile", undefined);
  const firstName = (account.data as { name?: string } | undefined)?.name?.trim().split(/\s+/)[0];
  const now = new Date();
  const today = timeZone ? dayOf(now.toISOString(), timeZone) : null;
  const todays = readout?.date === today ? readout : null;
  return (
    <header className="flex flex-col gap-1">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-muted-foreground first-letter:uppercase">
          {title} · {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(timeZone ? { timeZone } : {}) })}
        </span>
        <h1 className="text-3xl tracking-tight">{todays?.greeting ?? (firstName ? `Hi, ${firstName}` : "Hi")}</h1>
        {todays && <p className="max-w-2xl text-muted-foreground">{todays.directive}</p>}
      </div>
    </header>
  );
}
