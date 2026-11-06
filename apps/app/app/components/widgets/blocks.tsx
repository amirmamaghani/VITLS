import { type Icon, IconDots } from "@tabler/icons-react";
import { getMetric } from "@vitls/health-ingest";
import { ema } from "@vitls/physiology";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { Area, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { MealView } from "../../../shared/meals";
import type { WorkoutRow } from "../../../shared/widget-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Rounds the total first, then splits it in base 60 (never "x:60"): minutes -> "7:05" (h:mm), seconds -> "2:00" (m:ss). */
export const hm = (total: number) => {
  const t = Math.round(total);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** A value split into the figure and its unit, so the unit can be set smaller (bento style). */
export function formatParts(metric: string, value: number | null | undefined): { value: string; unit: string } {
  if (value === null || value === undefined) return { value: "—", unit: "" };
  const unit = getMetric(metric)?.unit;
  if (unit === "s") {
    const min = Math.round(value / 60);
    return min >= 60 ? { value: hm(min), unit: "h" } : { value: String(min), unit: "min" };
  }
  if (unit === "m") {
    if (value >= 1000) return { value: (value / 1000).toFixed(1), unit: "km" };
    return value < 3 ? { value: String(Math.round(value * 100)), unit: "cm" } : { value: String(Math.round(value)), unit: "m" };
  }
  const suffix: Record<string, string> = { kg: "kg", kcal: "kcal", bpm: "bpm", ms: "ms", pct: "%", brpm: "/min", mmHg: "mmHg", years: "y", g: "g", mg: "mg", ug: "µg", ml: "ml" };
  const digits = unit === "kg" || unit === "pct" ? 1 : 0;
  return { value: value.toLocaleString(undefined, { maximumFractionDigits: digits }), unit: suffix[unit ?? ""] ?? "" };
}

/** Human formatting for canonical units (kg, m, s, kcal, bpm, ms, …). */
export function formatValue(metric: string, value: number | null | undefined): string {
  const p = formatParts(metric, value);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

// ── Building blocks (shared by every widget family and the meal card) ───────

export function IconBadge({ icon: I }: { icon: Icon }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background">
      <I className="size-5" stroke={1.6} aria-hidden="true" />
    </span>
  );
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "primary" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums", tone === "primary" && "text-primary")}>
      {children}
    </span>
  );
}

/** The headline figure: big number, smaller unit in the primary colour. */
export function Figure({ value, unit, size = "lg" }: { value: string; unit?: string; size?: "lg" | "md" }) {
  return (
    <span className={cn("flex items-baseline gap-1 tracking-tight tabular-nums", size === "lg" ? "text-4xl" : "text-2xl")}>
      {value}
      {unit && <span className={cn("text-primary", size === "lg" ? "text-lg" : "text-sm")}>{unit}</span>}
    </span>
  );
}

/** "Oct 2" for a YYYY-MM-DD day in the interface language (noon UTC keeps the calendar day in every zone). */
export function useDay(options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  const { formatDate } = useFormatters();
  return (day: string) => formatDate(new Date(`${day}T12:00:00Z`), { ...options, timeZone: "UTC" });
}

export function DateSpan({ rows }: { rows: { date: string }[] }) {
  const fmt = useDay();
  if (rows.length < 2) return null;
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{fmt(rows[0]!.date)}</span>
      <span>{fmt(rows[rows.length - 1]!.date)}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

export function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="h-4 w-20 animate-pulse rounded-full bg-background" />
      <div className="h-12 w-40 animate-pulse rounded-full bg-background" />
    </div>
  );
}

/** Line charts run edge to edge: cancel the card's 1.25 rem side padding (bars, text and pills keep it). */
export const BLEED = "-mx-5 w-[calc(100%+2.5rem)]";

/** Chart tooltips use the glass surface (global.css); clearing recharts' inline white lets the class paint it. */
export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "none", backgroundColor: undefined, fontSize: 13 },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
  cursor: false,
} as const;

/**
 * Smooth line with a soft fill and no axes; the Y range is fitted to the data so small changes stay visible. It grows
 * into the card's spare height (min 5 rem). The chart is absolutely placed so it gets a height in auto-height cards too
 * (chat), where a 100 % height would resolve to 0. `muted` draws it grey as a backdrop for a big number; `reversed` flips the axis (lower is better, e.g. pace).
 */
/** Raw values as a soft area, with the EMA trend drawn over them; `muted` is the sparkline behind a headline number. */
export function Wave({ rows, format, muted = false, reversed = false }: { rows: { date: string; value: number }[]; format: (v: number) => string; muted?: boolean; reversed?: boolean }) {
  const id = useId().replace(/:/g, "");
  const t = useT();
  const day = useDay();
  const ink = muted ? "hsl(var(--muted-foreground) / 0.45)" : "hsl(var(--chart-1))";
  const trend = new Map(ema(rows).map((p) => [p.date, p.value]));
  const data = muted ? rows : rows.map((r) => ({ ...r, trend: trend.get(r.date) }));
  return (
    <div className={cn(BLEED, "relative flex-1", muted ? "min-h-12" : "min-h-20")}>
      <ResponsiveContainer width="100%" height="100%" className="absolute inset-0">
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ink} stopOpacity={muted ? 0.12 : 0.22} />
              <stop offset="100%" stopColor={ink} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide reversed={reversed} domain={["dataMin", "dataMax"]} />
          <Tooltip {...tooltipStyle} labelFormatter={(d) => day(String(d))} formatter={(v, name) => [format(Number(v)), muted ? "" : t(name === "trend" ? "widgets.trend.trend" : "widgets.trend.value")]} separator={muted ? "" : ": "} />
          <Area isAnimationActive={false} type="monotone" dataKey="value" stroke={muted ? ink : "hsl(var(--muted-foreground) / 0.45)"} strokeWidth={muted ? 1.5 : 1.25} fill={`url(#${id})`} dot={false} activeDot={{ r: 3 }} />
          {!muted && <Line isAnimationActive={false} type="monotone" dataKey="trend" stroke={ink} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The shared bar row: equal flexible slots whose gap is a quarter of one slot, clamped to 1–6 px (global.css
 * `.bar-row`), so bars keep even spacing on wide cards and never collapse on narrow ones. Each slot shows a glass
 * tooltip on hover; a handful of bars stay capped in width instead of turning into blocks.
 */
function BarRow({ count, label, children, className }: { count: number; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn("bar-row min-h-20 w-full flex-1", className)} style={{ "--bars": Math.max(1, count) } as React.CSSProperties}>
      <div>{children}</div>
    </div>
  );
}

function BarSlot({ tip, index, count, children }: { tip: string; index: number; count: number; children: React.ReactNode }) {
  return (
    <div className="group relative">
      {children}
      <span
        className={cn(
          "glass pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-xl px-2.5 py-1 text-xs tabular-nums opacity-0 transition-opacity group-hover:opacity-100",
          index < count / 2 ? "left-0" : "right-0",
        )}
      >
        {tip}
      </span>
    </div>
  );
}

const slotTip = (date: string, value: string) => `${date} · ${value}`;

/** Rounded bars from a zero baseline spread evenly across the width; latest in the primary colour, the rest grey. */
export function Bars({ rows, format }: { rows: { date: string; value: number }[]; format: (v: number) => string }) {
  const t = useT();
  const day = useDay();
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <BarRow count={rows.length} label={t("widgets.a11y.bars", { count: rows.length, latest: rows.length ? format(rows[rows.length - 1]!.value) : "—" })}>
      {rows.map((r, i) => (
        <BarSlot key={r.date} tip={slotTip(day(r.date), format(r.value))} index={i} count={rows.length}>
          <span className="absolute inset-x-0 bottom-0 rounded-md" style={{ height: max > 0 ? `${(Math.max(0, r.value) / max) * 100}%` : 0, background: i === rows.length - 1 ? PRIMARY : GREY }} />
        </BarSlot>
      ))}
    </BarRow>
  );
}

/** Card menu: only the items whose handlers are given (dashboard: move/remove; everywhere: the expanded data view). */
export function WidgetMenu({ label, onMove, onRemove, dataHref }: { label: string; onMove?: (delta: -1 | 1) => void; onRemove?: () => void; dataHref?: string }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full" aria-label={t("widgets.menu.options", { title: label })}>
          <IconDots className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {dataHref && (
            <DropdownMenuItem asChild>
              <Link to={dataHref}>{t("data.showData")}</Link>
            </DropdownMenuItem>
          )}
          {onMove && <DropdownMenuItem onSelect={() => onMove(-1)}>{t("widgets.menu.moveUp")}</DropdownMenuItem>}
          {onMove && <DropdownMenuItem onSelect={() => onMove(1)}>{t("widgets.menu.moveDown")}</DropdownMenuItem>}
          {onRemove && <DropdownMenuItem onSelect={onRemove}>{t("widgets.menu.remove")}</DropdownMenuItem>}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Segmented ring on an ink disc (reference "growth rate" gauge): round-capped arcs with small gaps, coral for the part
 * that matters, muted tones for the rest. In dark mode the disc inverts with the ink token.
 */
export function Ring({ segments, value, label }: { segments: { fraction: number; color: string }[]; value: string; label: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const gap = 0.07 * c; // visible gap between arcs, including the round caps
  let start = 0;
  const arcs = segments
    .filter((seg) => seg.fraction > 0)
    .map((seg) => {
      const full = segments.filter((x) => x.fraction > 0).length === 1 && seg.fraction >= 1;
      const arc = { color: seg.color, len: full ? c : Math.max(0.5, seg.fraction * c - gap), offset: full ? 0 : -(start * c + gap / 2) };
      start += seg.fraction;
      return arc;
    });
  return (
    <div className="relative aspect-square w-full max-w-36">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="hsl(var(--foreground))" />
        {arcs.map((a, i) => (
          <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={a.color} strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${a.len} ${c}`} strokeDashoffset={a.offset} />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-background">
        <span className="text-2xl tracking-tight tabular-nums">{value}</span>
        <span className="text-xs opacity-60">{label}</span>
      </div>
    </div>
  );
}

export const RING = { primary: "hsl(var(--primary))", light: "hsl(var(--background))", muted: "hsl(var(--background) / 0.28)" };

export type Summary = { latest: number | null; trend: number | null; deviationPct: number | null; recent?: number | null; baseline?: number | null; days?: number; sd?: number | null; ratePerWeek?: number | null };
export type HealthResult = {
  daily?: Record<string, { values: { date: string; value: number }[]; buckets?: { date: string; value: number; days?: number }[]; summary: Summary }>;
  points?: Record<string, { values: { at: string; value: number }[]; summary: Summary; lastChange?: { deltaKg: number; check: { maxPlausibleFatKg: number; kcalRequired: number } } }>;
  sleep?: { start: string; end?: string; durationMin: number; stageMinutes?: Record<string, number> }[];
  workouts?: WorkoutRow[];
  meals?: MealView[];
};

/** What every health-backed body shows before it has data: the skeleton while loading, the error text on failure. */
export function statusOf({ loading, error }: { loading: boolean; error?: string }): ReactNode {
  if (loading) return <Loading />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  return null;
}

// ── Visual blocks for the catalog (plain data in, three colours, no animation) ──

const PRIMARY = "hsl(var(--primary))";
const GREY = "hsl(var(--muted-foreground) / 0.3)";
/** Round dots in a grid (streaks, habits): on = primary, off = grey, none = outline only. */
export function DotGrid({ cells, columns = 7 }: { cells: { key: string; state: "on" | "off" | "none"; title: string }[]; columns?: number }) {
  const t = useT();
  const on = cells.filter((c) => c.state === "on").length;
  return (
    <div role="img" aria-label={t("widgets.a11y.dots", { on, total: cells.length })} className="grid gap-y-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {/* Columns share the full width; dots stay capped so a wide card spreads them instead of inflating them. */}
      {cells.map((c) => (
        <span key={c.key} className="flex justify-center">
          <span
            title={c.title}
            className={cn("aspect-square w-full max-w-6 rounded-full", c.state === "on" && "bg-primary", c.state === "off" && "bg-muted-foreground/30", c.state === "none" && "border border-border")}
          />
        </span>
      ))}
    </div>
  );
}

/** Vertical stacked bars; each part uses its own colour (pass opacity steps of the three tokens). */
export function StackedBars({ rows, colors, format }: { rows: { date: string; parts: number[] }[]; colors: string[]; format: (v: number) => string }) {
  const t = useT();
  const day = useDay();
  const total = (r: { parts: number[] }) => r.parts.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...rows.map(total));
  return (
    <BarRow count={rows.length} label={t("widgets.a11y.bars", { count: rows.length, latest: rows.length ? format(total(rows[rows.length - 1]!)) : "—" })}>
      {rows.map((r, i) => (
        <BarSlot key={r.date} tip={slotTip(day(r.date), format(total(r)))} index={i} count={rows.length}>
          <span className="absolute inset-x-0 bottom-0 flex flex-col-reverse overflow-hidden rounded-t-md" style={{ height: max > 0 ? `${(total(r) / max) * 100}%` : 0 }}>
            {colors.map((fill, j) => (
              <span key={j} style={{ flexGrow: r.parts[j] ?? 0, flexBasis: 0, background: fill }} />
            ))}
          </span>
        </BarSlot>
      ))}
    </BarRow>
  );
}

/** Bars around a zero baseline: negative (deficit) in the primary colour, positive grey. */
export function DivergingBars({ rows, format }: { rows: { date: string; value: number }[]; format: (v: number) => string }) {
  const t = useT();
  const day = useDay();
  const hi = Math.max(0, ...rows.map((r) => r.value));
  const lo = Math.min(0, ...rows.map((r) => r.value));
  const span = hi - lo || 1;
  const zero = (hi / span) * 100; // distance of the zero line from the top, in %
  return (
    <BarRow count={rows.length} label={t("widgets.a11y.bars", { count: rows.length, latest: rows.length ? format(rows[rows.length - 1]!.value) : "—" })}>
      {rows.map((r, i) => (
        <BarSlot key={r.date} tip={slotTip(day(r.date), format(r.value))} index={i} count={rows.length}>
          <span
            className={cn("absolute inset-x-0", r.value < 0 ? "rounded-b-md" : "rounded-t-md")}
            style={{ top: `${r.value < 0 ? zero : zero - (r.value / span) * 100}%`, height: `${(Math.abs(r.value) / span) * 100}%`, background: r.value < 0 ? PRIMARY : GREY }}
          />
        </BarSlot>
      ))}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px max-w-none bg-muted-foreground/50" style={{ top: `${zero}%` }} />
    </BarRow>
  );
}

/** Line over a moving personal normal range (a soft band that follows the rolling baseline ± 1 SD); gaps where history is short. */
export function BandLine({ rows, format }: { rows: { date: string; value: number; low: number | null; high: number | null }[]; format: (v: number) => string }) {
  const t = useT();
  const day = useDay();
  const data = rows.map((r) => ({ ...r, band: r.low === null || r.high === null ? null : [r.low, r.high] }));
  const latest = rows[rows.length - 1];
  return (
    <div role="img" aria-label={t("widgets.a11y.band", { latest: latest ? format(latest.value) : "—" })} className={cn(BLEED, "relative min-h-20 flex-1")}>
      <ResponsiveContainer width="100%" height="100%" className="absolute inset-0">
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip {...tooltipStyle} labelFormatter={(d) => day(String(d))} formatter={(v, name) => (name === "band" ? [null, null] : [format(Number(v)), ""])} separator="" />
          <Area isAnimationActive={false} type="monotone" dataKey="band" fill="hsl(var(--muted-foreground))" fillOpacity={0.15} stroke="none" activeDot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="value" stroke={PRIMARY} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Floating vertical bars from start to end (bed to wake) on a fixed domain, ticks at both ends; latest primary. */
export function RangeBars({ rows, domain, formatTick, ticks }: { rows: { date: string; start: number; end: number }[]; domain: [number, number]; formatTick: (v: number) => string; ticks?: number[] }) {
  const t = useT();
  const day = useDay();
  const [d0, d1] = domain;
  const span = d1 - d0 || 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - d0) / span) * 100))}%`;
  return (
    <div role="img" aria-label={t("widgets.a11y.ranges", { count: rows.length })} className="flex min-h-20 w-full flex-1 gap-2">
      {ticks ? (
        <div className="relative w-5 text-xs text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: pct(t) }}>
              {formatTick(t)}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-col justify-between text-xs text-muted-foreground tabular-nums">
          <span>{formatTick(d0)}</span>
          <span>{formatTick(d1)}</span>
        </div>
      )}
      <BarRow count={rows.length} label={t("widgets.a11y.nights", { count: rows.length })} className="min-h-0">
        {rows.map((r, i) => (
          <BarSlot key={r.date} tip={slotTip(day(r.date), `${formatTick(r.start)} – ${formatTick(r.end)}`)} index={i} count={rows.length}>
            <span
              className="absolute inset-x-0 rounded-md"
              style={{ top: pct(Math.min(r.start, r.end)), bottom: `calc(100% - ${pct(Math.max(r.start, r.end))})`, background: i === rows.length - 1 ? PRIMARY : GREY }}
            />
          </BarSlot>
        ))}
      </BarRow>
    </div>
  );
}

/** Weekday rows by week columns (oldest left); value steps map to primary opacity 0.15/0.4/0.7/1, empty is grey. */
export function Heatmap({ cells, columns = 12, format }: { cells: { date: string; value: number | null }[]; columns?: number; format: (v: number) => string }) {
  const t = useT();
  const day = useDay({ weekday: "short", day: "numeric", month: "short" });
  const shown = cells.slice(-7 * columns);
  const max = Math.max(0, ...shown.map((c) => c.value ?? 0));
  const opacity = (v: number | null) => {
    if (!v || max <= 0) return null;
    const f = v / max;
    return f > 0.75 ? 1 : f > 0.5 ? 0.7 : f > 0.25 ? 0.4 : 0.15;
  };
  const active = shown.filter((c) => c.value).length;
  return (
    <div role="img" aria-label={t("widgets.a11y.heatmap", { active, total: shown.length })} className="grid grid-flow-col grid-rows-7 gap-1" style={{ gridTemplateColumns: `repeat(${Math.ceil(shown.length / 7)}, minmax(0, 1fr))` }}>
      {shown.map((c) => {
        const o = opacity(c.value);
        return <span key={c.date} title={slotTip(day(c.date), c.value ? format(c.value) : "—")} className={cn("aspect-square rounded-[4px]", o === null && "bg-muted-foreground/15")} style={o === null ? undefined : { background: PRIMARY, opacity: o }} />;
      })}
    </div>
  );
}

/** Short insight rows on rounded background tiles, like the workout rows. */
export function NoteList({ items }: { items: { title: string; detail?: string; tone?: "primary" | "plain" }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((n, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 rounded-2xl bg-background px-4 py-3">
          <span className={cn("text-sm", n.tone === "primary" && "text-primary")}>{n.title}</span>
          {n.detail && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{n.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The headline row of a widget: small muted label over the figure, optional pill on the right. */
export function Stat({ label, value, unit, pill, tone = "primary", size = "md" }: { label: string; value: string; unit?: string; pill?: ReactNode; tone?: "plain" | "primary"; size?: "lg" | "md" }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Figure value={value} unit={unit} size={size} />
      </div>
      {pill && <Pill tone={tone}>{pill}</Pill>}
    </div>
  );
}
