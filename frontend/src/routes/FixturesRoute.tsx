import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchTicker } from "../lib/api";
import type { FdrMode } from "../lib/types";
import type { TickerSort } from "../features/ticker/fdr";
import { Ticker } from "../features/ticker/Ticker";

const MODES: { value: FdrMode; label: string; note: string }[] = [
  { value: "official", label: "Official FDR", note: "FPL's own 1–5 fixture difficulty." },
  { value: "attack", label: "Attack", note: "How hard to SCORE — from the opponent’s xG conceded over their last 10 matches." },
  { value: "defence", label: "Defence", note: "How hard to keep a CLEAN SHEET — from the opponent’s xG scored over their last 10 matches." },
];

export function FixturesRoute() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ticker"],
    queryFn: fetchTicker,
  });
  const [mode, setMode] = useState<FdrMode>("official");
  const [windowSize, setWindowSize] = useState(6);
  const [sort, setSort] = useState<TickerSort>({ key: "avg", dir: "asc" });

  if (isLoading) return <div className="skeleton h-96 w-full" />;
  if (isError || !data)
    return (
      <div className="card p-6 text-fdr-5 text-sm">
        Fixture ticker unavailable. Run <code>uv run python -m pipeline.run_publish</code>.
      </div>
    );

  const activeNote = MODES.find((m) => m.value === mode)?.note;

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`pill border ${
                mode === m.value
                  ? "bg-brand-dim text-surface-0 border-brand"
                  : "bg-surface-2 text-ink-muted border-surface-3"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label className="text-xs text-ink-faint ml-2">Window</label>
        <select
          className="input"
          value={windowSize}
          onChange={(e) => setWindowSize(Number(e.target.value))}
        >
          {[3, 5, 6, 8].map((n) => (
            <option key={n} value={n}>
              next {n} GWs
            </option>
          ))}
        </select>

        <span className="text-xs text-ink-muted ml-auto">
          {describeSort(sort)} · click any column header to sort · current GW {data.current_gw ?? "—"}
        </span>
      </div>

      <p className="text-xs text-ink-faint">{activeNote} Colour is paired with the numeric value; lower is easier.</p>

      <Ticker ticker={data} mode={mode} windowSize={windowSize} sort={sort} onSort={setSort} />
    </div>
  );
}

function describeSort({ key, dir }: TickerSort): string {
  if (key === "team") return `Team ${dir === "asc" ? "A–Z" : "Z–A"}`;
  const what = key === "avg" ? "run" : `GW${key} fixture`;
  return dir === "asc" ? `Easiest ${what} first` : `Hardest ${what} first`;
}
