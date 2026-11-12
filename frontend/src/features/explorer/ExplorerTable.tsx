import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

import { TeamBadge } from "../../components/TeamBadge";
import { fmtCompact, fmtNum, fmtPrice, positionColor } from "../../lib/format";
import type { PlayerForm } from "../../lib/types";
import { EXPLORER_COLUMNS } from "./columns";

const ch = createColumnHelper<PlayerForm>();
const NAME_W = 200;

const columns = [
  // An accessor (not a display column) so the Player column is sortable —
  // TanStack only offers sorting on columns that read a value.
  ch.accessor("name", {
    id: "name",
    header: "Player",
    size: NAME_W,
    cell: (ctx) => {
      const p = ctx.row.original;
      return (
        <div className="flex items-center gap-2 min-w-0">
          <span className={`pill ${positionColor(p.position)}`}>{p.position}</span>
          <div className="leading-tight min-w-0">
            <div className="text-ink font-medium truncate">{p.name}</div>
            <div className="text-[11px] text-ink-faint truncate">
              <TeamBadge team={p.team_name} size={12} withLabel />
            </div>
          </div>
        </div>
      );
    },
  }),
  ch.accessor("price_m", {
    header: "Price",
    size: 72,
    cell: (ctx) => fmtPrice(ctx.getValue()),
  }),
  ...EXPLORER_COLUMNS.map((meta) =>
    ch.accessor((row) => row[meta.key], {
      id: meta.key,
      size: meta.width ?? 70,
      header: () => <span title={meta.help}>{meta.header}</span>,
      cell: (ctx) => {
        const v = ctx.getValue() as number | null;
        if (meta.compact) {
          return <span title={v === null ? undefined : Math.round(v).toLocaleString()}>{fmtCompact(v)}</span>;
        }
        return meta.dp !== undefined
          ? fmtNum(v, meta.dp)
          : v === null
            ? "—"
            : Math.round(v).toLocaleString();
      },
    }),
  ),
];

interface Props {
  rows: PlayerForm[];
  sorting: SortingState;
  onSortingChange: (s: SortingState) => void;
  onSelect: (p: PlayerForm) => void;
  loading: boolean;
}

export function ExplorerTable({ rows, sorting, onSortingChange, onSelect, loading }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Track the scroller's width so the table can fill a wide screen instead of
  // leaving dead space to the right of the last column.
  const [availWidth, setAvailWidth] = useState(0);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setAvailWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) =>
      onSortingChange(typeof updater === "function" ? updater(sorting) : updater),
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  // Any width beyond the columns' natural size goes to the Player column, which
  // is the one that actually benefits (long names stop being truncated).
  const naturalWidth = table.getTotalSize();
  const slack = Math.max(0, availWidth - naturalWidth);
  const totalWidth = naturalWidth + slack;
  const widthFor = (index: number, size: number) => (index === 0 ? size + slack : size);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={parentRef}
      className="card overflow-auto relative"
      style={{ height: "calc(100vh - 260px)", minHeight: 420 }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-surface-1 flex border-b border-surface-2"
        style={{ width: totalWidth }}
      >
        {headers.map((header, i) => {
          const sorted = header.column.getIsSorted();
          return (
            <div
              key={header.id}
              onClick={header.column.getToggleSortingHandler()}
              className={`px-2 py-2 text-ink-muted font-medium cursor-pointer select-none hover:text-ink flex items-center ${
                i === 0 ? "sticky left-0 z-10 bg-surface-1" : "justify-end"
              }`}
              style={{ width: widthFor(i, header.getSize()) }}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              <span className="text-brand ml-1 w-2">
                {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = tableRows[vi.index];
          if (!row) return null;
          return (
            <div
              key={row.id}
              onClick={() => onSelect(row.original)}
              className="absolute flex hover:bg-surface-2 cursor-pointer border-b border-surface-2/40"
              style={{ transform: `translateY(${vi.start}px)`, height: vi.size, width: totalWidth }}
            >
              {row.getVisibleCells().map((cell, i) => (
                <div
                  key={cell.id}
                  className={`px-2 flex items-center tabular-nums text-ink-muted overflow-hidden whitespace-nowrap ${
                    i === 0 ? "sticky left-0 bg-surface-1/95" : "justify-end"
                  }`}
                  style={{ width: widthFor(i, cell.column.getSize()) }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="sticky bottom-0 left-0 right-0 bg-surface-0/60 text-center py-1.5 text-ink-muted text-xs">
          filtering…
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-sm">
          No players match these filters.
        </div>
      )}
    </div>
  );
}
