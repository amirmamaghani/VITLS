import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { StatsCard } from "@agent-native/toolkit/dashboard";
import { IconArrowDown, IconArrowUp, IconCalendarStats, IconChartLine, IconDatabase, IconDownload } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { getMetric } from "@vitls/health-ingest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { CoverageHeatmap } from "@/components/health-data/CoverageHeatmap";
import { DataTable } from "@/components/health-data/DataTable";
import { loadAllRows } from "@/components/health-data/export-all";
import { dayOf, detailOf, displayOf, flatten, formatNumber, isWinner, numericOf, sourceName, sourceOf, summarize, when } from "@/components/health-data/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HealthWidget } from "@/components/widgets";
import { useUserTimeZone } from "@/components/widgets/coach";
import { downloadFile, toCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

import type { RawResult, RawRow } from "../../../server/lib/health/raw";
import type { RangeKey, Widget } from "../../../shared/dashboard";
import { defaultWidget, SECTION_WIDGETS } from "../../../shared/data-catalog";

const SECTIONS = ["sleep", "workouts", "meals"] as const;
type Section = (typeof SECTIONS)[number];
const isSection = (key: string): key is Section => (SECTIONS as readonly string[]).includes(key);
const GROUP_KEY: Record<Section, string> = { sleep: "data.groupSleep", workouts: "data.groupWorkouts", meals: "data.groupMeals" };
/** Source colors: the primary coral first, then the chart palette (CSS tokens from design-system-theme). */
const TONES = ["hsl(var(--primary))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))", "hsl(var(--chart-2))"];

/** Windows of raw rows, newest first; `loadMore` appends the next older window until the server says there is none. */
function useRawWindows(dataKey: string) {
  const [pages, setPages] = useState<RawResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = pages[pages.length - 1];
  const done = pages.length > 0 && last!.nextBefore === null;
  const nextBefore = last?.nextBefore ?? undefined;
  const loadMore = useCallback(async () => {
    if (loading || done || !dataKey) return;
    setLoading(true);
    try {
      const query = isSection(dataKey) ? { section: dataKey } : { metric: dataKey };
      const page = (await callAction("get-health-raw", { ...query, before: nextBefore, days: 92 } as never, { method: "GET" })) as RawResult;
      setPages((prev) => [...prev, page]);
    } catch (failure) {
      setError((failure as Error & { actionMessage?: string }).actionMessage ?? (failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dataKey, loading, done, nextBefore]);
  useEffect(() => {
    if (pages.length === 0 && !loading && !error) void loadMore();
  }, [pages.length, loading, error, loadMore]);
  const rows = useMemo(() => pages.flatMap((p) => p.rows), [pages]);
  const sources = useMemo(() => {
    const map = new Map<string, RawResult["sources"][number]>();
    for (const p of pages) for (const s of p.sources) map.set(s.id, s);
    return [...map.values()];
  }, [pages]);
  return { rows, sources, loading, done, error, loadMore };
}

type ConflictRow = { day: string; values: Record<string, number | undefined>; winnerId: string; spread: number };

/** The dashboard widget, expanded: stats, chart, sources, coverage, then rows / conflicts / export in tabs. */
export function MetricDetail({ dataKey }: { dataKey: string }) {
  const t = useT();
  const def = getMetric(dataKey);
  const section = isSection(dataKey) ? dataKey : null;
  const known = Boolean(section) || (def !== undefined && def.kind !== "intraday");
  const [range, setRange] = useState<RangeKey>("90d");
  const { rows, sources, loading, done, error, loadMore } = useRawWindows(known ? dataKey : "");
  const sentinel = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const timeZone = useUserTimeZone();

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const kind = rows[0]?.kind ?? (section === "sleep" ? "sleep" : section === "workouts" ? "workout" : section === "meals" ? "meal" : def?.kind === "point" ? "point" : "daily");
  const stats = useMemo(() => summarize(rows, timeZone), [rows, timeZone]);
  const toneIndex = (sourceId: string) => Math.max(0, sources.findIndex((s) => s.id === sourceId)) % TONES.length;

  /** Days where more than one source reported and the values differ. */
  const conflicts = useMemo<ConflictRow[]>(() => {
    const byDay = new Map<string, RawRow[]>();
    for (const r of rows) {
      if (r.kind !== "daily" && r.kind !== "point") continue;
      const key = r.kind === "daily" ? r.day : r.at;
      byDay.set(key, [...(byDay.get(key) ?? []), r]);
    }
    const out: ConflictRow[] = [];
    for (const [day, group] of byDay) {
      if (group.length < 2) continue;
      const values = group.map(numericOf);
      const min = Math.min(...values), max = Math.max(...values);
      if (max === min) continue;
      const winner = group.find(isWinner) ?? group[0]!;
      out.push({ day: when(day, timeZone), values: Object.fromEntries(group.map((r) => [sourceOf(r).id, numericOf(r)])), winnerId: sourceOf(winner).id, spread: max === 0 ? 0 : ((max - min) / max) * 100 });
    }
    return out;
  }, [rows, timeZone]);

  const coverage = useMemo(() => {
    const days = new Map<string, number>();
    for (const r of rows) if (isWinner(r)) days.set(dayOf(r, timeZone), toneIndex(sourceOf(r).id));
    const sorted = [...days.keys()].sort();
    return { days, start: sorted[0] ?? null, end: sorted[sorted.length - 1] ?? null };
  }, [rows, timeZone, sources]); // eslint-disable-line react-hooks/exhaustive-deps

  const wins = useMemo(() => {
    const total = rows.filter(isWinner).length;
    const bySource = new Map<string, { rows: number; wins: number }>();
    for (const r of rows) {
      const id = sourceOf(r).id;
      const cur = bySource.get(id) ?? { rows: 0, wins: 0 };
      bySource.set(id, { rows: cur.rows + 1, wins: cur.wins + (isWinner(r) ? 1 : 0) });
    }
    return { total, bySource };
  }, [rows]);

  if (!known) {
    return (
      <Empty className="py-24">
        <EmptyHeader>
          <EmptyTitle>{t("data.notFound")}</EmptyTitle>
          <EmptyDescription>
            <Link to="/data" className="underline">{t("data.title")}</Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const widget = (section ? { ...SECTION_WIDGETS[section], wide: true } : { ...defaultWidget(dataKey), range, wide: true }) as Widget;
  const title = section ? t(GROUP_KEY[section]) : dataKey.replace(/_/g, " ");
  const fmt = (value: number) => formatNumber(dataKey, kind, value);

  const exportRows = async (format: "csv" | "json") => {
    if (exporting) return;
    setExporting(format);
    setExportError(null);
    try {
      const all = done ? rows : await loadAllRows(dataKey);
      const name = `vitls-${dataKey}-${new Date().toISOString().slice(0, 10)}`;
      if (format === "json") downloadFile(`${name}.json`, "application/json", JSON.stringify(all, null, 2));
      else downloadFile(`${name}.csv`, "text/csv", toCsv(all.map(flatten)));
    } catch (failure) {
      setExportError((failure as Error & { actionMessage?: string }).actionMessage ?? (failure as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const rowColumns: ColumnDef<RawRow, unknown>[] = [
    { id: "when", header: section ? t("data.start") : t("data.date"), size: 170, accessorFn: (r) => (r.kind === "daily" ? r.day : r.kind === "point" ? r.at : r.kind === "meal" ? r.meal.eatenAt : r.start), cell: ({ row }) => (row.original.kind === "daily" ? row.original.day : when(row.original.kind === "point" ? row.original.at : row.original.kind === "meal" ? row.original.meal.eatenAt : row.original.start, timeZone)) },
    { id: "value", header: t("data.value"), size: 150, accessorFn: numericOf, cell: ({ row }) => <span className="font-medium">{displayOf(row.original, dataKey)}</span> },
    { id: "detail", header: "", accessorFn: detailOf, enableSorting: false, cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue())}</span> },
    {
      id: "source",
      header: t("data.sources"),
      size: 220,
      accessorFn: (r) => sourceName(sourceOf(r)),
      cell: ({ row }) => {
        const s = sourceOf(row.original);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: TONES[toneIndex(s.id)] }} />
            {sourceName(s)}
            {isWinner(row.original) && "winner" in row.original ? <Badge variant="secondary" className="ms-1 px-1.5 py-0 text-[10px]">{t("data.winner")}</Badge> : null}
          </span>
        );
      },
    },
    { id: "updated", header: t("data.updatedAt"), size: 150, accessorFn: (r) => (r.kind === "meal" ? r.meal.eatenAt : r.updatedAt), cell: ({ getValue }) => <span className="text-muted-foreground">{when(String(getValue()), timeZone)}</span> },
  ];

  const conflictColumns: ColumnDef<ConflictRow, unknown>[] = [
    { id: "day", header: t("data.date"), size: 170, accessorKey: "day" },
    ...sources.map<ColumnDef<ConflictRow, unknown>>((s, i) => ({
      id: s.id,
      header: `${sourceName(s)}${sources.filter((o) => sourceName(o) === sourceName(s)).length > 1 ? ` (${i + 1})` : ""}`,
      size: 160,
      accessorFn: (r) => r.values[s.id] ?? null,
      cell: ({ row }) => {
        const v = row.original.values[s.id];
        return v === undefined ? <span className="text-muted-foreground">—</span> : <span className={cn(row.original.winnerId === s.id && "font-semibold")}>{fmt(v)}</span>;
      },
    })),
    { id: "spread", header: "Δ", size: 90, accessorKey: "spread", cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as number).toFixed(0)} %</span> },
  ];

  return (
    <div className="flex max-w-6xl flex-col gap-8 px-6 py-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link to="/data" className="text-sm text-muted-foreground hover:text-foreground">
            {t("data.title")}
          </Link>
          <h1 className="text-3xl tracking-tight first-letter:uppercase">{title}</h1>
          {def && <p className="text-muted-foreground">{def.description}</p>}
          {exportError && <p className="text-sm text-destructive">{exportError}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-full" disabled={!!exporting}>
              <IconDownload className="size-4" strokeWidth={1.8} />
              {exporting ? t("data.exporting") : t("data.tabExport")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportRows("csv")}>{t("data.exportCsv")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportRows("json")}>{t("data.exportJson")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&_[data-slot=card]]:widget-tint [&>*]:rounded-2xl">
          <StatsCard title={t("data.latest")} value={fmt(stats.latest.value)} icon={IconChartLine} description={stats.latest.day} trend={stats.latest.delta !== null && stats.latest.value !== 0 ? { value: Math.round((stats.latest.delta / Math.max(Math.abs(stats.latest.value - stats.latest.delta), 1e-9)) * 100), label: t("data.vsPrevious") } : undefined} />
          <StatsCard title={t("data.average")} value={fmt(stats.average)} icon={IconCalendarStats} description={t("data.firstToLast", { first: coverage.start ?? "", last: coverage.end ?? "" })} />
          <StatsCard title={t("data.minimum")} value={fmt(stats.min.value)} icon={IconArrowDown} description={stats.min.day} />
          <StatsCard title={t("data.maximum")} value={fmt(stats.max.value)} icon={IconArrowUp} description={stats.max.day} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid lg:col-span-2 [&>*]:h-full">
          <HealthWidget widget={widget} onRange={section ? undefined : setRange} dataHref={undefined} />
        </div>
        <Card className="widget-tint flex flex-col gap-4 overflow-hidden p-5">
          <header className="flex items-center gap-3">
            <h3 className="min-w-0 flex-1 truncate text-base">{t("data.sources")}</h3>
            <Badge variant="secondary">{t("data.rows", { count: stats?.count ?? 0 })}</Badge>
          </header>
          <ul className="flex flex-col gap-3 text-sm">
            {sources.map((s) => {
              const w = wins.bySource.get(s.id) ?? { rows: 0, wins: 0 };
              const percent = wins.total ? Math.round((w.wins / wins.total) * 100) : 0;
              return (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: TONES[toneIndex(s.id)] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate first-letter:uppercase">{sourceName(s)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.via} · {t("data.rows", { count: w.rows })}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t("data.wins", { percent })}</span>
                </li>
              );
            })}
            {sources.length === 0 && !loading && <li className="text-muted-foreground">{t("data.noData")}</li>}
          </ul>
          {coverage.start && coverage.end && (
            <div className="mt-auto flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">{t("data.coverage")}</span>
              <CoverageHeatmap days={coverage.days} tones={TONES} start={coverage.start} end={coverage.end} labelOf={(i) => (sources[i] ? sourceName(sources[i]!) : "")} />
            </div>
          )}
        </Card>
      </div>

      <Card className="widget-tint flex flex-col gap-4 overflow-hidden p-5">
        <Tabs defaultValue="rows">
          <TabsList>
            <TabsTrigger value="rows">{t("data.tabRows")}</TabsTrigger>
            {!section && <TabsTrigger value="conflicts">{t("data.tabConflicts")}{conflicts.length > 0 ? ` · ${conflicts.length}` : ""}</TabsTrigger>}
            <TabsTrigger value="export">{t("data.tabExport")}</TabsTrigger>
          </TabsList>
          <TabsContent value="rows" className="mt-4">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            {rows.length === 0 && done ? (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyTitle>{t("data.noData")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <DataTable
                columns={rowColumns}
                data={rows}
                rowClassName={(r) => (!isWinner(r) ? "text-muted-foreground" : "")}
                footer={
                  <div ref={sentinel} className="py-4 text-center text-xs text-muted-foreground">
                    {done ? t("data.allLoaded", { count: rows.length }) : loading ? t("data.loadingOlder") : null}
                  </div>
                }
              />
            )}
          </TabsContent>
          {!section && (
            <TabsContent value="conflicts" className="mt-4">
              {conflicts.length === 0 ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyTitle>{t("data.noConflictsYet")}</EmptyTitle>
                    <EmptyDescription>{t("data.noConflicts")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <DataTable columns={conflictColumns} data={conflicts} maxHeight="50vh" />
              )}
            </TabsContent>
          )}
          <TabsContent value="export" className="mt-4">
            <div className="flex flex-col gap-4 text-sm">
              <p className="max-w-2xl text-muted-foreground">{t("data.exportHint")}</p>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-full" disabled={!!exporting} onClick={() => void exportRows("csv")}>
                  {exporting === "csv" ? t("data.exporting") : t("data.exportCsv")}
                </Button>
                <Button variant="outline" className="rounded-full" disabled={!!exporting} onClick={() => void exportRows("json")}>
                  {exporting === "json" ? t("data.exporting") : t("data.exportJson")}
                </Button>
              </div>
              <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <IconDatabase className="size-3.5" />
                {done ? t("data.allLoaded", { count: rows.length }) : t("data.loadingOlder")}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
