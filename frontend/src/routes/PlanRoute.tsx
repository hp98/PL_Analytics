import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PitchMarkings } from "../components/PitchMarkings";
import { TeamBadge } from "../components/TeamBadge";
import { TeamKit } from "../components/TeamKit";
import { fetchOptimalSquad, fetchPlayersLive, fetchProjections } from "../lib/api";
import { fmtNum, fmtPrice, positionColor } from "../lib/format";
import type { OptimalPick, OptimalSquad, Position } from "../lib/types";
import { bestUpgradeFor, perGwTotals, type PlanPlayer, planTransfers } from "../features/myteam/analysis";
import { pickBestXi } from "../features/myteam/squad";
import { useMyTeam } from "../features/myteam/useMyTeam";
import { usePlayerBoard } from "../features/insights/usePlayerBoard";
import { useUiStore } from "../store/useUiStore";

const ORDER: Position[] = ["GKP", "DEF", "MID", "FWD"];
const HIT_COST = 4;
type Tab = "transfers" | "captaincy" | "draft";

const horizonXp = (p: PlanPlayer, horizon: number[]) =>
  horizon.reduce((s, gw) => s + (p.gws.get(gw) ?? 0), 0);

/** Dense rank: equal scores share a rank and the next distinct score is +1, so
 * "top 5" never silently drops a tied captain candidate. */
function denseRanked<T>(rows: T[], score: (r: T) => number, maxRank: number) {
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const out: { row: T; rank: number }[] = [];
  let rank = 0;
  let prev: number | null = null;
  for (const row of sorted) {
    const v = Math.round(score(row) * 100) / 100;
    if (prev === null || v !== prev) rank += 1;
    if (rank > maxRank) break;
    out.push({ row, rank });
    prev = v;
  }
  return out;
}

export function PlanRoute() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "transfers";
  const setTab = (t: Tab) => setParams(t === "transfers" ? {} : { tab: t }, { replace: true });

  const entryId = useUiStore((s) => s.entryId);
  const myEntry = entryId && /^\d+$/.test(entryId) ? Number(entryId) : null;
  const { view } = useMyTeam(myEntry);

  const { data: optimal } = useQuery({
    queryKey: ["optimal-squad"],
    queryFn: fetchOptimalSquad,
    staleTime: 30 * 60 * 1000,
  });
  const { data: projections } = useQuery({ queryKey: ["projections"], queryFn: fetchProjections });
  const { data: playersLive } = useQuery({ queryKey: ["players-live"], queryFn: fetchPlayersLive });

  const [weeks, setWeeks] = useState(5);
  const [transfers, setTransfers] = useState(1);
  const [freeTransfers, setFreeTransfers] = useState(1);

  const horizon = useMemo(
    () => (projections?.horizon ?? []).slice(0, weeks),
    [projections, weeks],
  );

  const candidates: PlanPlayer[] = useMemo(() => {
    if (!playersLive || !projections) return [];
    return playersLive
      .filter((p) => p.position && ["a", "d"].includes(p.status))
      .map((p) => ({
        element: p.element,
        name: p.web_name,
        position: p.position as Position,
        team: p.team_short ?? "?",
        price: p.price_m,
        gws: new Map((projections.players[String(p.element)]?.per_gw ?? []).map((g) => [g.gw, g.xp])),
      }));
  }, [playersLive, projections]);

  const squad: PlanPlayer[] = useMemo(() => {
    if (!view) return [];
    return [...view.rows.flat(), ...view.bench].map((e) => ({
      element: e.pick.element,
      name: e.el?.web_name ?? `#${e.pick.element}`,
      position: e.position as Position,
      team: e.teamShort,
      price: e.el ? e.el.now_cost / 10 : 0,
      gws: view.perGw.get(e.pick.element) ?? new Map(),
    }));
  }, [view]);

  const plan = useMemo(() => {
    if (squad.length === 0 || candidates.length === 0 || horizon.length === 0) return null;
    return planTransfers({
      squad,
      candidates,
      horizon,
      bank: view?.bankM ?? 0,
      maxTransfers: transfers,
      freeTransfers,
      hitCost: HIT_COST,
    });
  }, [squad, candidates, horizon, view, transfers, freeTransfers]);

  // Where the gain actually lands, gameweek by gameweek.
  const gwImpact = useMemo(() => {
    if (!plan || horizon.length === 0) return [];
    const before = perGwTotals(squad, horizon);
    const after = perGwTotals(plan.squad, horizon);
    return before.map((b, i) => ({ gw: b.gw, before: b.xp, after: after[i]?.xp ?? b.xp }));
  }, [plan, squad, horizon]);

  // Where a transfer is actually worth making. Ranking by the player's own xP
  // gets this wrong: the lowest scorer is often bench cover whose replacement
  // would barely touch the XI. Ranking by the best legal swap available for each
  // slot answers the question the panel is really asking, and agrees with the
  // plan above because both are valued in the same currency.
  const opportunities = useMemo(() => {
    if (squad.length === 0 || horizon.length === 0 || candidates.length === 0) return [];
    return squad
      .map((p) => ({
        p,
        xp: horizonXp(p, horizon),
        upgrade: bestUpgradeFor({
          squad,
          candidates,
          horizon,
          bank: view?.bankM ?? 0,
          element: p.element,
        }),
      }))
      .filter((r) => r.upgrade !== null)
      .sort((a, b) => (b.upgrade?.gain ?? 0) - (a.upgrade?.gain ?? 0))
      .slice(0, 4);
  }, [squad, candidates, horizon, view]);

  const capAfter = useMemo(() => {
    if (!plan || horizon.length === 0) return null;
    const gw = horizon[0]!;
    const before = pickBestXi(squad, (p) => p.gws.get(gw) ?? 0).captain;
    const after = pickBestXi(plan.squad, (p) => p.gws.get(gw) ?? 0).captain;
    return { gw, before, after };
  }, [plan, squad, horizon]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-ink mr-1">Transfers &amp; Captaincy</h1>
          {(
            [
              ["transfers", "Plan my transfers"],
              ["captaincy", "Captaincy"],
              ["draft", "Wildcard draft"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pill border ${
                tab === t
                  ? "bg-brand-dim text-surface-0 border-brand"
                  : "bg-surface-2 text-ink-muted border-surface-3 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "transfers" && (
          <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
            <Select label="Horizon" value={weeks} onChange={setWeeks}
              options={[1, 2, 3, 5, 8].map((n) => [n, `next ${n} GW${n > 1 ? "s" : ""}`])} />
            <Select label="Transfers" value={transfers} onChange={setTransfers}
              options={[0, 1, 2, 3, 4].map((n) => [n, String(n)])} />
            <Select label="Free" value={freeTransfers} onChange={setFreeTransfers}
              options={[0, 1, 2, 3, 4, 5].map((n) => [n, String(n)])} />
            <span className="text-[11px] text-ink-faint">
              Totals are your best legal XI with the captain doubled — bench players score nothing.
              Hits cost −{HIT_COST} beyond your free transfers and are netted off.
            </span>
          </div>
        )}
      </div>

      {tab === "transfers" && (
        <TransfersTab
          myEntry={myEntry}
          plan={plan}
          horizon={horizon}
          gwImpact={gwImpact}
          opportunities={opportunities}
          capAfter={capAfter}
        />
      )}
      {tab === "captaincy" && <CaptaincyTab squadIds={new Set(squad.map((p) => p.element))} />}
      {tab === "draft" && <DraftTab optimal={optimal} />}
    </div>
  );
}

// --- Transfers ---------------------------------------------------------------

function TransfersTab({
  myEntry, plan, horizon, gwImpact, opportunities, capAfter,
}: {
  myEntry: number | null;
  plan: ReturnType<typeof planTransfers> | null;
  horizon: number[];
  gwImpact: { gw: number; before: number; after: number }[];
  opportunities: { p: PlanPlayer; xp: number; upgrade: { in: PlanPlayer; gain: number } | null }[];
  capAfter: { gw: number; before: PlanPlayer | null; after: PlanPlayer | null } | null;
}) {
  if (myEntry === null) {
    return (
      <div className="card p-6 text-sm text-ink-muted">
        Set your entry ID on the{" "}
        <Link to="/my-team" className="text-brand">My Team</Link> screen to plan transfers.
      </div>
    );
  }
  if (!plan) return <div className="skeleton h-64 w-full" />;

  const maxBar = Math.max(...gwImpact.flatMap((g) => [g.before, g.after]), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-3">
        <div className="card hero p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label={`As you are (${horizon.length} GW)`} value={plan.baselineXp.toFixed(1)} />
            <Metric label="After the plan" value={plan.plannedXp.toFixed(1)} />
            <Metric label="Hits" value={plan.hits ? `−${plan.hits}` : "0"} tone="warn" />
            <Metric
              label="Net gain"
              value={`${plan.netGain >= 0 ? "+" : ""}${plan.netGain.toFixed(1)}`}
              tone={plan.netGain > 0 ? "good" : plan.netGain < 0 ? "bad" : undefined}
              big
            />
          </div>
          <p className="text-[11px] text-ink-faint mt-3">
            {plan.netGain > 0
              ? `Worth doing: ${plan.moves.length} transfer(s) gain ${plan.netGain.toFixed(1)} projected points after hits, across GW${horizon[0]}–${horizon[horizon.length - 1]}.`
              : plan.moves.length === 0
                ? "No transfer improves your starting XI over this horizon — holding is the better move."
                : `This plan loses ${Math.abs(plan.netGain).toFixed(1)} points once hits are paid. Fewer transfers, or a longer horizon, may pay off instead.`}{" "}
            Bank after: {fmtPrice(plan.bankAfter)}.
          </p>
        </div>

        {gwImpact.length > 0 && (
          <div className="card p-4">
            <div className="text-sm text-ink font-medium mb-0.5">Where the gain lands</div>
            <p className="text-[11px] text-ink-faint mb-3">
              Projected XI points per gameweek, before and after the plan.
            </p>
            <div className="space-y-1.5">
              {gwImpact.map((g) => {
                const delta = Math.round((g.after - g.before) * 10) / 10;
                return (
                  <div key={g.gw} className="flex items-center gap-2 text-xs">
                    <span className="w-10 text-ink-faint tabular-nums">GW{g.gw}</span>
                    <div className="flex-1 h-4 bg-surface-2 rounded relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-surface-3 rounded"
                        style={{ width: `${(g.before / maxBar) * 100}%` }} />
                      {delta > 0 && (
                        <div className="absolute inset-y-0 bg-brand-dim"
                          style={{ left: `${(g.before / maxBar) * 100}%`, width: `${(delta / maxBar) * 100}%` }} />
                      )}
                    </div>
                    <span className="w-10 text-right tabular-nums text-ink">{g.after.toFixed(1)}</span>
                    <span className={`w-10 text-right tabular-nums ${delta > 0 ? "text-brand" : "text-ink-faint"}`}>
                      {delta > 0 ? `+${delta.toFixed(1)}` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="table-card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-ink-muted text-xs">
              <tr className="border-b border-surface-2">
                <th className="text-left px-3 py-2">Out</th>
                <th className="text-left px-3 py-2">In</th>
                <th className="text-right px-3 py-2">XI gain</th>
                <th className="text-right px-3 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {plan.moves.map((m, i) => (
                <tr key={i} className="border-b border-surface-2/40">
                  <td className="px-3 py-2">
                    <span className="text-fdr-5">{m.out.name}</span>{" "}
                    <TeamBadge team={m.out.team} size={13} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-brand">{m.in.name}</span>{" "}
                    <TeamBadge team={m.in.team} size={13} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-brand font-semibold">
                    +{m.gain.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {m.costChange >= 0 ? `−${fmtPrice(m.costChange)}` : `+${fmtPrice(-m.costChange)}`}
                  </td>
                </tr>
              ))}
              {plan.moves.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-ink-faint">
                    No improving transfer found within your budget and club limits.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="space-y-3">
        {capAfter?.after && (
          <div className="card p-4">
            <div className="text-sm text-ink font-medium mb-1">Captain · GW{capAfter.gw}</div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-brand">{capAfter.after.name}</span>
              <TeamBadge team={capAfter.after.team} size={16} />
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">
              {capAfter.before && capAfter.before.element !== capAfter.after.element
                ? `The plan changes your captain — ${capAfter.before.name} was the pick before it.`
                : "Unchanged by this plan."}
            </p>
          </div>
        )}

        <div className="card p-4">
          <div className="text-sm text-ink font-medium mb-2">Where a transfer helps most</div>
          <ul className="space-y-1.5 text-xs">
            {opportunities.map(({ p, xp, upgrade }) => (
              <li key={p.element}>
                <div className="flex items-center gap-2">
                  <span className={`pill ${positionColor(p.position)} !px-1.5`}>{p.position}</span>
                  <span className="text-ink">{p.name}</span>
                  <TeamBadge team={p.team} size={13} />
                  <span className="text-ink-faint ml-auto tabular-nums">{xp.toFixed(1)} xP</span>
                </div>
                <div className="text-[11px] text-ink-faint pl-1 mt-0.5">
                  {upgrade ? (
                    <>
                      best swap → <span className="text-brand">{upgrade.in.name}</span>{" "}
                      <span className="tabular-nums">+{upgrade.gain.toFixed(1)}</span>
                    </>
                  ) : (
                    "no affordable upgrade"
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-faint mt-2">
            Every squad slot ranked by what its best legal replacement would add to your XI, after
            budget and the three-per-club limit. Your lowest scorer is often not the answer — bench
            cover can be replaced for almost no gain.
          </p>
        </div>
      </aside>
    </div>
  );
}

// --- Captaincy ---------------------------------------------------------------

function CaptaincyTab({ squadIds }: { squadIds: Set<number> }) {
  const { board, isLoading, isError } = usePlayerBoard();
  const { data: projections } = useQuery({ queryKey: ["projections"], queryFn: fetchProjections });
  const [sort, setSort] = useState<"xp" | "ceiling">("xp");
  // Default to the user's own squad, but the squad loads asynchronously — so
  // fall back to the full pool whenever it isn't there yet rather than freezing
  // the choice made on the first render.
  const [scope, setScope] = useState<"squad" | "all">("squad");
  const effectiveScope = scope === "squad" && squadIds.size === 0 ? "all" : scope;

  if (isLoading) return <div className="skeleton h-96 w-full" />;
  if (isError) return <div className="card p-6 text-fdr-5 text-sm">Projections unavailable.</div>;

  const nextGw = projections?.horizon?.[0] ?? null;
  // Candidates need a fixture next gameweek. Goalkeepers are excluded: the
  // armband is about ceiling, and a keeper's P(>=10) is ~0.
  const pool = board.filter(
    (p) => p.xpNext > 0 && p.position !== "GKP" && (effectiveScope === "all" || squadIds.has(p.element)),
  );
  const ranked = denseRanked(pool, (p) => (sort === "xp" ? p.xpNext : p.pHaul), 5);
  const best = ranked[0]?.row;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink font-medium">
            Best armband{nextGw !== null && <span className="text-ink-muted font-normal"> · GW{nextGw}</span>}
          </span>
          <div className="flex items-center gap-1 ml-auto flex-wrap">
            {squadIds.size > 0 &&
              (["squad", "all"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)}
                  className={`pill border ${effectiveScope === s ? "bg-brand-dim text-surface-0 border-brand" : "bg-surface-2 text-ink-muted border-surface-3"}`}>
                  {s === "squad" ? "My squad" : "All players"}
                </button>
              ))}
            <span className="text-xs text-ink-faint mx-1">by</span>
            {(["xp", "ceiling"] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)}
                className={`pill border ${sort === s ? "bg-brand-dim text-surface-0 border-brand" : "bg-surface-2 text-ink-muted border-surface-3"}`}>
                {s === "xp" ? "Projected pts" : "Ceiling P(≥10)"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-faint mt-1.5">
          {effectiveScope === "squad"
            ? "Ranked within your own squad — you can only captain a player you own. Switch to all players to scout armband-worthy transfer targets."
            : "Ranked across every available player — useful for spotting a transfer target, but you can only captain someone you own."}{" "}
          Top 5 by dense rank for the next gameweek only; tied players share a rank. Captain points
          = projected × 2; P(≥10) is the haul chance from 5,000 Monte-Carlo simulations.
        </p>
      </div>

      {!best && (
        <div className="card p-6 text-sm text-ink-muted">
          No candidate with a fixture next gameweek{effectiveScope === "squad" ? " in your squad" : ""}.
        </div>
      )}

      {best && (
        <div className="card hero p-4 flex flex-wrap items-center gap-4">
          <div className="text-[10px] uppercase tracking-wide text-ink-faint">Pick</div>
          <div className="flex items-center gap-2">
            <span className={`pill ${positionColor(best.position)}`}>{best.position}</span>
            <span className="text-xl font-semibold text-ink">{best.name}</span>
            <TeamBadge team={best.team} size={20} />
          </div>
          <div className="ml-auto flex gap-5 text-right">
            <div>
              <div className="text-[10px] uppercase text-ink-faint">Captain xP</div>
              <div className="text-2xl font-semibold text-brand tabular-nums">{fmtNum(best.xpNext * 2, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-faint">P(≥10)</div>
              <div className="text-2xl font-semibold text-ink tabular-nums">{Math.round(best.pHaul * 100)}%</div>
            </div>
          </div>
        </div>
      )}

      {ranked.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-ink-muted text-xs">
              <tr className="border-b border-surface-2">
                <th className="text-left px-3 py-2 w-12">#</th>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-right px-3 py-2">Cap xP</th>
                <th className="text-right px-3 py-2">P(≥10)</th>
                <th className="text-right px-3 py-2">P(return)</th>
                <th className="text-right px-3 py-2">Own%</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ row: p, rank }) => (
                <tr key={p.element} className="border-b border-surface-2/40 hover:bg-surface-2">
                  <td className="px-3 py-2 text-ink-faint tabular-nums">{rank}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`pill ${positionColor(p.position)} !px-1.5`}>{p.position}</span>
                      <span className="text-ink">{p.name}</span>
                      {effectiveScope === "all" && squadIds.has(p.element) && (
                        <span className="pill bg-brand-dim/20 text-brand !px-1.5 text-[10px]">owned</span>
                      )}
                      <span className="text-[11px] text-ink-faint">
                        <TeamBadge team={p.team} size={14} withLabel />
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-brand font-semibold">{fmtNum(p.xpNext * 2, 1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Math.round(p.pHaul * 100)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{Math.round(p.pReturn * 100)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-faint">{fmtNum(p.ownership, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Wildcard draft ----------------------------------------------------------

function PickCard({ p }: { p: OptimalPick }) {
  return (
    <div className="w-[62px] sm:w-[76px]">
      <div className="player-card" title={`${p.team} · ${p.position}`}>
        {p.is_captain && (
          <span className="absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center bg-brand text-surface-0 shadow">
            C
          </span>
        )}
        <TeamKit team={p.team} isKeeper={p.position === "GKP"} size={40} />
        <div className="player-card__name">{p.web_name}</div>
        <div className="flex w-full">
          <div className="player-card__value player-card__value--muted !rounded-none !rounded-bl flex-1">
            {fmtPrice(p.price)}
          </div>
          <div className="player-card__value !rounded-none !rounded-br flex-1" title="Projected points over the horizon">
            {p.xp.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftTab({ optimal: opt }: { optimal: OptimalSquad | undefined }) {
  if (!opt) return <div className="skeleton h-96 w-full" />;
  const starters = opt.picks.filter((p) => p.is_start);
  const bench = opt.picks.filter((p) => !p.is_start);
  const rows = ORDER.map((pos) => starters.filter((p) => p.position === pos)).filter((r) => r.length);

  return (
    <>
      <div className="card p-4">
        <p className="text-sm text-ink-muted">
          The best 15 the optimiser can build from £100.0m for GWs {opt.horizon.join(", ")}, by
          projected points — a wildcard/blank-slate target, solved with a mixed-integer program
          honouring every FPL squad rule.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
          <Metric label={`XI proj (${opt.horizon.length} GW)`} value={opt.xi_xp.toFixed(1)} />
          <Metric label="Cost" value={fmtPrice(opt.cost)} />
          <Metric label="Bank" value={fmtPrice(opt.bank)} />
          <Metric label="Solver" value={opt.status} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-3 sm:p-4">
          <div className="pitch-wrap">
            <div className="pitch-bg">
              <PitchMarkings />
              <div className="pitch-rows">
                {rows.map((row, i) => (
                  <div key={i} className="pitch-row">
                    {row.map((p) => <PickCard key={p.element} p={p} />)}
                  </div>
                ))}
              </div>
            </div>
            <div className="pitch-bench">
              <div className="text-[10px] uppercase tracking-wide text-white/55 mb-1.5 text-center">Bench</div>
              <div className="pitch-row">
                {bench.map((p) => <PickCard key={p.element} p={p} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- shared ------------------------------------------------------------------

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  options: [number, string][];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Metric({
  label, value, tone, big = false,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
  big?: boolean;
}) {
  const colour =
    tone === "good" ? "text-brand"
      : tone === "bad" ? "text-fdr-5"
        : tone === "warn" ? "text-fdr-4"
          : "text-ink";
  return (
    <div className="bg-surface-2 rounded-lg p-2.5">
      <div className="text-[10px] uppercase text-ink-faint">{label}</div>
      <div className={`font-semibold tabular-nums ${big ? "text-2xl" : "text-sm"} ${colour}`}>{value}</div>
    </div>
  );
}
