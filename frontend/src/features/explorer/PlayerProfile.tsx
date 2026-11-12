import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { query, sqlString } from "../../lib/duckdb";
import { fmtNum, fmtPrice, positionColor } from "../../lib/format";
import type { PlayerForm } from "../../lib/types";
import { useUiStore } from "../../store/useUiStore";

/** Chart colours read from the active theme's CSS variables (recomputed when
 * the theme changes) so charts match dark / light / football. */
function useChartColors() {
  const theme = useUiStore((s) => s.theme);
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const c = (name: string) => `rgb(${cs.getPropertyValue(name).trim()})`;
    return {
      axis: { stroke: c("--ink-faint"), fontSize: 11 },
      grid: c("--surface-3"),
      brand: c("--brand"),
      xgLine: c("--fdr-3"),
      priceLine: c("--fdr-2"),
      tooltip: {
        background: c("--surface-2"),
        border: `1px solid ${c("--surface-3")}`,
        borderRadius: 8,
        fontSize: 12,
        color: c("--ink"),
      },
    };
    // theme is the dependency that triggers recompute after applyTheme runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

interface GwRow {
  gw: number;
  points: number;
  goals: number;
  xg: number | null;
  price_m: number;
}

function usePlayerHistory(player: PlayerForm) {
  return useQuery({
    queryKey: ["player-history", player.player_nk],
    queryFn: () =>
      query<GwRow>(
        // sum() over an integer column returns HUGEINT, which reaches JS as an
        // Arrow Decimal whose scale is lost — 9 points renders as 9000. Cast the
        // integer aggregates back to a plain INT so only safe types cross the
        // wasm boundary. (The xG/price columns are DOUBLE and unaffected.)
        `select gw,
                sum(total_points)::INT           as points,
                sum(goals_scored)::INT           as goals,
                sum(expected_goals)              as xg,
                max(price_m)                     as price_m
         from read_parquet('fct_player_gameweek.parquet')
         where season = ${sqlString(player.season)} and element = ${player.element}
         group by gw order by gw`,
      ),
  });
}

export function PlayerProfile({ player, onClose }: { player: PlayerForm; onClose: () => void }) {
  const { data: history, isLoading } = usePlayerHistory(player);
  const { axis, grid, brand, xgLine, priceLine, tooltip } = useChartColors();

  // cumulative xG vs actual goals (over/under-performance)
  let cumXg = 0;
  let cumG = 0;
  const cumulative = (history ?? []).map((r) => {
    cumXg += r.xg ?? 0;
    cumG += r.goals;
    return { gw: r.gw, xg: Number(cumXg.toFixed(2)), goals: cumG };
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto bg-surface-1 border-l border-surface-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-1 border-b border-surface-2 p-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`pill ${positionColor(player.position)}`}>{player.position}</span>
              <h2 className="text-lg font-semibold text-ink">{player.name}</h2>
            </div>
            <div className="text-sm text-ink-muted mt-0.5">
              {player.team_name} · {player.season} · {fmtPrice(player.price_m)}
            </div>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5">
          <div className="grid grid-cols-4 gap-2">
            <Kpi label="Points" value={String(player.season_points)} />
            <Kpi label="Mins" value={player.season_minutes.toLocaleString()} />
            <Kpi label="xGI" value={fmtNum(player.season_xgi, 2)} />
            <Kpi label="Pts/90" value={fmtNum(player.points_per90_last6, 2)} />
          </div>

          {isLoading && <div className="skeleton h-40 w-full" />}

          {!isLoading && history && (
            <>
              <ChartCard title="Points by gameweek">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={history}>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis dataKey="gw" {...axis} />
                    <YAxis {...axis} width={26} />
                    <Tooltip contentStyle={tooltip} />
                    <Bar dataKey="points" fill={brand} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Cumulative xG vs actual goals">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={cumulative}>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis dataKey="gw" {...axis} />
                    <YAxis {...axis} width={26} />
                    <Tooltip contentStyle={tooltip} />
                    <Line dataKey="xg" name="xG" stroke={xgLine} dot={false} strokeWidth={2} />
                    <Line dataKey="goals" name="Goals" stroke={brand} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-ink-faint mt-1">
                  Goals above the xG line = finishing over expectation (may regress).
                </p>
              </ChartCard>

              <ChartCard title="Price history">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={history}>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis dataKey="gw" {...axis} />
                    <YAxis {...axis} width={34} domain={["dataMin - 0.1", "dataMax + 0.1"]} />
                    <Tooltip contentStyle={tooltip} />
                    <Line dataKey="price_m" name="£m" stroke={priceLine} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-md p-2 text-center">
      <div className="text-[10px] uppercase text-ink-faint">{label}</div>
      <div className="text-ink font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm text-ink-muted mb-1">{title}</h3>
      {children}
    </div>
  );
}
