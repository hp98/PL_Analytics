import { useMemo, useState } from "react";

import { TeamBadge } from "../components/TeamBadge";
import { fmtNum, fmtPrice, positionColor } from "../lib/format";
import type { Position } from "../lib/types";
import { usePlayerBoard } from "../features/insights/usePlayerBoard";

const OWNERSHIP_STEPS = [3, 5, 10, 15];
const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];
type Horizon = "next" | "next5";

export function DifferentialsRoute() {
  const { board, isLoading, isError } = usePlayerBoard();
  const [maxOwn, setMaxOwn] = useState(10);
  const [positions, setPositions] = useState<Position[]>([]);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("next5");
  const [search, setSearch] = useState("");

  const ranked = useMemo(() => {
    const xpOf = (p: (typeof board)[number]) => (horizon === "next5" ? p.next5 : p.xpNext);
    return board
      .filter((p) => p.ownership <= maxOwn)
      .filter((p) => (positions.length === 0 ? true : positions.includes(p.position)))
      .filter((p) => (maxPrice === null ? true : p.price <= maxPrice))
      .filter((p) => (search.trim() === "" ? true : p.name.toLowerCase().includes(search.trim().toLowerCase())))
      .filter((p) => xpOf(p) > 0)
      .map((p) => ({ ...p, xp: xpOf(p), index: xpOf(p) / Math.max(p.ownership, 0.5) }))
      .sort((a, b) => b.index - a.index)
      .slice(0, 30);
  }, [board, maxOwn, positions, maxPrice, horizon, search]);

  if (isLoading) return <div className="skeleton h-96 w-full" />;
  if (isError) return <div className="card p-6 text-fdr-5 text-sm">Projections unavailable.</div>;

  const togglePos = (p: Position) =>
    setPositions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-ink mr-1">Differentials</h1>
          <input
            className="input flex-1 min-w-[140px] max-w-xs"
            placeholder="Search player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-1">
            {POSITIONS.map((p) => (
              <button
                key={p}
                onClick={() => togglePos(p)}
                className={`pill border ${positions.includes(p) ? "bg-brand-dim text-surface-0 border-brand" : "bg-surface-2 text-ink-muted border-surface-3"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-ink-faint">Max ownership</span>
          {OWNERSHIP_STEPS.map((t) => (
            <button
              key={t}
              onClick={() => setMaxOwn(t)}
              className={`pill border ${maxOwn === t ? "bg-brand-dim text-surface-0 border-brand" : "bg-surface-2 text-ink-muted border-surface-3"}`}
            >
              ≤{t}%
            </button>
          ))}

          <span className="text-xs text-ink-faint ml-2">Max price</span>
          <input
            type="number"
            step="0.5"
            className="input w-20"
            placeholder="any"
            value={maxPrice ?? ""}
            onChange={(e) => setMaxPrice(e.target.value === "" ? null : Number(e.target.value))}
          />

          <span className="text-xs text-ink-faint ml-2">Horizon</span>
          <select
            className="input"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
          >
            <option value="next5">next 5 GWs</option>
            <option value="next">next GW</option>
          </select>

          <span className="text-xs text-ink-muted ml-auto">{ranked.length} shown</span>
          <button
            className="btn"
            onClick={() => {
              setMaxOwn(10);
              setPositions([]);
              setMaxPrice(null);
              setHorizon("next5");
              setSearch("");
            }}
          >
            Reset
          </button>
        </div>
        <p className="text-[11px] text-ink-faint">
          Differential index = projected xP per ownership point. Low ownership + high xP climbs rank
          fastest when it returns.
        </p>
      </div>

      <div className="table-card overflow-x-auto">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="text-ink-muted text-xs">
            <tr className="border-b border-surface-2">
              <th className="text-left px-3 py-2 w-12">#</th>
              <th className="text-left px-3 py-2">Player</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Own%</th>
              <th className="text-right px-3 py-2">
                xP ({horizon === "next5" ? "5GW" : "next"})
              </th>
              <th className="text-right px-3 py-2">Diff index</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.element} className="border-b border-surface-2/40 hover:bg-surface-2">
                <td className="px-3 py-2 text-ink-faint tabular-nums">{i + 1}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`pill ${positionColor(p.position)} !px-1.5`}>{p.position}</span>
                    <span className="text-ink">{p.name}</span>
                    <span className="text-[11px] text-ink-faint">
                      <TeamBadge team={p.team} size={14} withLabel />
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPrice(p.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                  {fmtNum(p.ownership, 1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-brand font-semibold">
                  {fmtNum(p.xp, 1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.index, 1)}</td>
              </tr>
            ))}
            {ranked.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-faint">
                  No players match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
