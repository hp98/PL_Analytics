import { useMemo } from "react";

import { TeamBadge } from "../../components/TeamBadge";
import type { FdrMode, FixtureTicker, TickerCell } from "../../lib/types";
import { fdrClasses, fdrValue, sortTeams, type TickerSort, type TickerSortKey } from "./fdr";

interface Props {
  ticker: FixtureTicker;
  mode: FdrMode;
  windowSize: number;
  sort: TickerSort;
  onSort: (sort: TickerSort) => void;
}

export function Ticker({ ticker, mode, windowSize, sort, onSort }: Props) {
  const gws = useMemo(() => ticker.horizon.slice(0, windowSize), [ticker, windowSize]);

  const teams = useMemo(
    () => sortTeams(ticker.teams, gws, mode, sort),
    [ticker, gws, mode, sort],
  );

  // Clicking the active column flips direction; a new column starts on the
  // natural reading -- easiest first for difficulty, A-Z for team.
  const toggle = (key: TickerSortKey) =>
    onSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });

  const gridCols = `minmax(96px, 1fr) ${gws.map(() => "minmax(70px, 1fr)").join(" ")} 64px`;

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-max">
        {/* header */}
        <div className="grid items-center border-b border-surface-2" style={{ gridTemplateColumns: gridCols }}>
          <SortHeader label="Team" sortKey="team" sort={sort} onToggle={toggle}
            className="px-2 justify-start sticky left-0 bg-surface-1 z-10" />
          {gws.map((gw) => (
            <SortHeader key={gw} label={`GW${gw}`} sortKey={gw} sort={sort} onToggle={toggle} />
          ))}
          <SortHeader label="Avg" sortKey="avg" sort={sort} onToggle={toggle}
            title="Average difficulty over the window — click to sort" />
        </div>

        {/* rows */}
        {teams.map((t) => {
          const avg = t.avg;
          return (
            <div
              key={t.team_id}
              className="grid items-stretch border-b border-surface-2/40"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="px-2 py-1.5 font-medium text-ink sticky left-0 bg-surface-1 z-10 flex items-center">
                <TeamBadge team={t.short_name} size={16} withLabel />
              </div>
              {gws.map((gw) => (
                <Cell key={gw} cells={t.cells[String(gw)] ?? []} mode={mode} />
              ))}
              <div className="px-1 py-1.5 text-center text-sm tabular-nums text-ink-muted flex items-center justify-center">
                {avg !== null ? avg.toFixed(2) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortHeader({
  label, sortKey, sort, onToggle, className = "px-1 justify-center", title,
}: {
  label: string;
  sortKey: TickerSortKey;
  sort: TickerSort;
  onToggle: (key: TickerSortKey) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title={title ?? `Sort by ${label}`}
        className={`w-full py-2 flex items-center gap-1 text-xs hover:text-ink ${
          className.includes("justify-start") ? "justify-start" : "justify-center"
        } ${active ? "text-ink font-medium" : "text-ink-muted"}`}
      >
        {label}
        <span className={active ? "text-brand" : "opacity-0"} aria-hidden>
          {active && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </div>
  );
}

function Cell({ cells, mode }: { cells: TickerCell[]; mode: FdrMode }) {
  if (cells.length === 0) {
    // Blank gameweek — dim, explicitly labelled (not just empty colour).
    return (
      <div className="m-0.5 rounded bg-surface-2/50 text-ink-faint text-[10px] flex items-center justify-center py-1">
        BLANK
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 p-0.5">
      {cells.map((cell, i) => {
        const v = fdrValue(cell, mode);
        const { bg, text } = fdrClasses(v);
        return (
          <div
            key={i}
            className={`rounded ${bg} ${text} px-1 py-1 text-center leading-tight`}
            title={`${cell.opp_short} (${cell.home ? "H" : "A"}) · FDR ${v ?? "—"}`}
          >
            <div className="text-[11px] font-semibold">
              {cell.opp_short} <span className="opacity-70">{cell.home ? "H" : "A"}</span>
            </div>
            <div className="text-[10px] tabular-nums opacity-90">{v ?? "—"}</div>
          </div>
        );
      })}
    </div>
  );
}
