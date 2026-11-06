import * as HeatGraph from "heat-graph";

import { cn } from "@/lib/utils";

/** GitHub-style weeks × days grid; each day is colored by the source whose value the coach used, gaps stay muted. */
export function CoverageHeatmap({ days, tones, start, end, labelOf }: { days: Map<string, number>; tones: string[]; start: string; end: string; labelOf: (level: number) => string }) {
  const data: HeatGraph.DataPoint[] = [...days.entries()].map(([date, sourceIndex]) => ({ date, count: sourceIndex + 1 }));
  const colors = ["transparent", ...tones];
  const weeks = Math.ceil((Date.parse(end) - Date.parse(start)) / (7 * 86_400_000)) + 2;
  const identity = () => (count: number) => count;
  const CELL = 11;
  const cellTitle = (cell: HeatGraph.CellData) => {
    const day = cell.date.toISOString().slice(0, 10);
    return cell.count ? `${day} · ${labelOf(cell.count - 1)}` : day;
  };
  return (
    <HeatGraph.Root data={data} start={new Date(start)} end={new Date(end)} weekStart="monday" classify={identity} colorScale={colors} className="flex w-full flex-col gap-1 overflow-x-auto text-[10px] text-muted-foreground">
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${weeks}, ${CELL}px)` }} aria-hidden="true">
        <HeatGraph.MonthLabels>
          {({ label, totalWeeks }) => (
            <span key={`${label.month}-${label.column}`} style={{ gridColumn: `${label.column + 1} / span ${Math.min(4, totalWeeks - label.column)}` }}>
              {HeatGraph.MONTH_SHORT[label.month]}
            </span>
          )}
        </HeatGraph.MonthLabels>
      </div>
      <HeatGraph.Grid className="gap-px" style={{ gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`, gridTemplateRows: `repeat(7, ${CELL}px)`, width: "max-content" }} aria-hidden="true">
        {({ cell }) => <HeatGraph.Cell key={`${cell.column}-${cell.row}`} title={cellTitle(cell)} className={cn("rounded-[2px]", cell.count === 0 && "bg-muted")} />}
      </HeatGraph.Grid>
    </HeatGraph.Root>
  );
}
