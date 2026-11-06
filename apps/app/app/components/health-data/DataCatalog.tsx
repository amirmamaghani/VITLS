import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { exportEverything } from "@/components/health-data/export-all";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HealthWidget } from "@/components/widgets";

import type { DataCatalog as Catalog } from "../../../server/lib/health/catalog";
import { DATA_GROUPS, defaultWidget, groupOf, SECTION_WIDGETS, type DataGroup } from "../../../shared/data-catalog";
import type { Widget } from "../../../shared/dashboard";

const GROUP_KEY: Record<DataGroup | "sleep" | "workouts" | "meals", string> = {
  activity: "data.groupActivity",
  recovery: "data.groupRecovery",
  body: "data.groupBody",
  nutrition: "data.groupNutrition",
  intraday: "data.groupIntraday",
  sleep: "data.groupSleep",
  workouts: "data.groupWorkouts",
  meals: "data.groupMeals",
};

function relative(iso: string | null, never: string): string {
  if (!iso) return never;
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  if (Math.abs(minutes) < 60 * 24) return rtf.format(-Math.round(minutes / 60), "hour");
  return rtf.format(-Math.round(minutes / (60 * 24)), "day");
}

/** A dashboard widget whose whole card opens the expanded view; the widget's own controls stay clickable above the link. */
function DataCard({ to, label, widget }: { to: string; label: string; widget: Widget }) {
  return (
    <div className="relative">
      <Link to={to} aria-label={label} className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="pointer-events-none relative z-10 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <HealthWidget widget={widget} />
      </div>
    </div>
  );
}

/** Every metric and section with records, grouped by theme; each card is the dashboard widget in its default view. */
export function DataCatalog() {
  const t = useT();
  const query = useActionQuery("get-data-catalog", {} as never);
  const catalog = query.data as Catalog | undefined;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const byGroup = new Map<DataGroup, { present: string[]; missing: string[] }>();
    for (const g of DATA_GROUPS) byGroup.set(g, { present: [], missing: [] });
    for (const m of catalog?.metrics ?? []) byGroup.get(groupOf(m.key))![m.rows > 0 ? "present" : "missing"].push(m.key);
    return byGroup;
  }, [catalog]);

  if (!catalog) return <div className="px-6 py-6" aria-busy="true" />;
  const empty = catalog.sources.length === 0 && catalog.metrics.every((m) => m.rows === 0);
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportEverything(catalog);
    } catch (failure) {
      setExportError((failure as Error & { actionMessage?: string }).actionMessage ?? (failure as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex max-w-6xl flex-col gap-8 px-6 py-6">
      <section className="flex flex-wrap items-start gap-3">
        {catalog.sources.map((s) => (
          <Card key={s.id} className="widget-tint flex min-w-48 flex-col gap-1 p-4">
            <span className="text-base first-letter:uppercase">{s.label ?? s.provider.replace("_", " ")}</span>
            <span className="text-xs text-muted-foreground">
              {s.via} · {t("data.rows", { count: s.rows })}
            </span>
            <span className="text-xs text-muted-foreground">{t("data.lastSync", { when: relative(s.lastSyncAt, t("data.never")) })}</span>
          </Card>
        ))}
        {!empty && (
          <Button variant="outline" className="ms-auto rounded-full" disabled={exporting} onClick={() => void exportAll()}>
            {exporting ? t("data.exporting") : t("data.exportAll")}
          </Button>
        )}
      </section>
      {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      {empty && <p className="py-16 text-center text-sm text-muted-foreground">{t("data.noData")}</p>}
      {DATA_GROUPS.map((group) => {
        const { present, missing } = groups.get(group)!;
        if (present.length === 0 && (group === "intraday" || empty)) return null;
        return (
          <section key={group} className="flex flex-col gap-4">
            <h2 className="text-xl tracking-tight">{t(GROUP_KEY[group])}</h2>
            {present.length > 0 && group === "intraday" && <p className="text-sm text-muted-foreground">{present.join(", ")}</p>}
            {present.length > 0 && group !== "intraday" && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {present.map((key) => (
                  <DataCard key={key} to={`/data/${key}`} label={key} widget={defaultWidget(key)} />
                ))}
              </div>
            )}
            {missing.length > 0 && group !== "intraday" && <p className="text-xs text-muted-foreground">{t("data.noSourceYet", { metrics: missing.join(", ") })}</p>}
          </section>
        );
      })}
      {(["sleep", "workouts", "meals"] as const).map((section) =>
        catalog.sections[section].rows > 0 ? (
          <section key={section} className="flex flex-col gap-4">
            <h2 className="text-xl tracking-tight">{t(GROUP_KEY[section])}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <DataCard to={`/data/${section}`} label={section} widget={SECTION_WIDGETS[section]} />
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
