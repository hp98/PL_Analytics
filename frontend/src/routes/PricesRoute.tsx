import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { TeamBadge } from "../components/TeamBadge";
import { fetchPricePredictor } from "../lib/api";
import { fmtNum, fmtPrice, positionColor } from "../lib/format";
import type { Position } from "../lib/types";

type Tab = "risers" | "fallers";
type SortKey = "prob" | "net_transfers" | "ownership_pct" | "price_m";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "price_m", label: "Price", align: "right" },
  { key: "net_transfers", label: "Net transfers", align: "right" },
  { key: "ownership_pct", label: "Own%", align: "right" },
  { key: "prob", label: "Probability", align: "right" },
];

export function PricesRoute() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["price-predictor"],
    queryFn: fetchPricePredictor,
    staleTime: 60_000,
  });
  const [tab, setTab] = useState<Tab>("risers");
  // Default to the tab's own probability; every column is clickable.
  const [sort, setSort] = useState<SortKey>("prob");
  const [desc, setDesc] = useState(true);

  const toggleSort = (key: SortKey) => {
    if (key === sort) {
      setDesc((d) => !d);
    } else {
      setSort(key);
      setDesc(true);
    }
  };

  if (isLoading) return <div className="skeleton h-96 w-full" />;
  if (isError || !data)
    return <div className="card p-6 text-fdr-5 text-sm">Price predictor unavailable.</div>;

  const valueOf = (p: (typeof data)[number]): number =>
    sort === "prob" ? (tab === "risers" ? p.p_rise : p.p_fall) : Number(p[sort]);
  const rows = [...data]
    .sort((a, b) => (desc ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b)))
    .slice(0, 25);
  const arrow = (key: SortKey) => (key === sort ? (desc ? " ▼" : " ▲") : "");

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-ink mr-2">Price predictor</h1>
        {(["risers", "fallers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pill border ${tab === t ? "bg-brand-dim text-surface-0 border-brand" : "bg-surface-2 text-ink-muted border-surface-3"}`}
          >
            {t === "risers" ? "▲ Risers" : "▼ Fallers"}
          </button>
        ))}
      </div>

      <div className="card p-3 text-xs text-fdr-4 bg-fdr-4/10 rounded-lg">
        ⚠️ This is a transparent <b>heuristic</b> on net-transfer momentum, not FPL's real
        (undisclosed) algorithm. Treat probabilities as directional, not guarantees.
      </div>

      <div className="table-card overflow-x-auto">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="text-ink-muted text-xs">
            <tr className="border-b border-surface-2">
              <th className="text-left px-3 py-2">Player</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="text-right px-3 py-2 cursor-pointer select-none hover:text-ink whitespace-nowrap"
                  title={`Sort by ${c.label}`}
                >
                  {c.key === "prob"
                    ? tab === "risers"
                      ? "P(rise)"
                      : "P(fall)"
                    : c.label}
                  <span className="text-brand">{arrow(c.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const prob = tab === "risers" ? p.p_rise : p.p_fall;
              const flagged = prob >= 0.7;
              return (
                <tr key={p.element} className="border-b border-surface-2/40 hover:bg-surface-2">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      {p.position && (
                        <span className={`pill ${positionColor(p.position as Position)} !px-1.5`}>
                          {p.position}
                        </span>
                      )}
                      <span className="text-ink">{p.web_name}</span>
                      <span className="text-[11px] text-ink-faint">
                        <TeamBadge team={p.team} size={14} withLabel />
                      </span>
                      {p.already_changed !== 0 && (
                        <span className="pill bg-surface-2 text-ink-faint">
                          already {p.already_changed > 0 ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtPrice(p.price_m)}</td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums ${p.net_transfers >= 0 ? "text-brand" : "text-fdr-5"}`}
                  >
                    {p.net_transfers >= 0 ? "+" : ""}
                    {p.net_transfers.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-faint">
                    {fmtNum(p.ownership_pct, 1)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums font-semibold ${flagged ? "text-fdr-4" : "text-ink-muted"}`}
                  >
                    {Math.round(prob * 100)}%{flagged ? " ⚑" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
