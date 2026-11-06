import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IconArrowDown, IconArrowUp, IconArrowsUpDown } from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The shadcn data-table pattern (TanStack Table 8 on the toolkit's Table primitives) with virtualized rows:
 * click a header to sort, scroll inside the card, the footer slot sits after the last row (the lazy-load sentinel).
 */
export function DataTable<T>({ columns, data, footer, rowClassName, maxHeight = "70vh" }: { columns: ColumnDef<T, unknown>[]; data: T[]; footer?: ReactNode; rowClassName?: (row: T) => string; maxHeight?: string }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const rows = table.getRowModel().rows;
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 44, overscan: 12 });
  const items = virtualizer.getVirtualItems();
  const template = columns.map((c) => (c.size ? `${c.size}px` : "minmax(8rem, 1fr)")).join(" ");

  return (
    <div ref={scroller} className="overflow-auto rounded-2xl" style={{ maxHeight }}>
      <Table className="grid">
        <TableHeader className="sticky top-0 z-10 grid bg-card">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="grid border-border/50" style={{ gridTemplateColumns: template }}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead key={header.id} className="flex h-10 items-center text-xs text-muted-foreground">
                    {header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? <IconArrowUp className="size-3" /> : sorted === "desc" ? <IconArrowDown className="size-3" /> : <IconArrowsUpDown className="size-3 opacity-50" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index]!;
            return (
              <TableRow
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn("absolute grid w-full border-border/30", rowClassName?.(row.original))}
                style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="flex min-w-0 items-center py-2 text-sm">
                    <span className="min-w-0 truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}
