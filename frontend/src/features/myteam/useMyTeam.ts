import { useQuery } from "@tanstack/react-query";

import { fetchOptimalSquad, fetchPlayersLive, fetchProjections } from "../../lib/api";
import {
  type Bootstrap,
  type BootstrapElement,
  type EntryHistory,
  type EntryPicks,
  type EntrySummary,
  fetchBootstrap,
  fetchEntry,
  fetchEntryHistory,
  fetchPicks,
  type Pick,
  POSITION_BY_TYPE,
} from "../../lib/fpl";
import type { OptimalSquad, PlayerLive, PlayerProjection, Position, Projections } from "../../lib/types";
import {
  buildCandidates,
  type ChipSuggestion,
  computeTeamRating,
  type SquadMember,
  suggestChips,
  suggestTransfers,
  type TeamRating,
  type TransferSuggestion,
} from "./analysis";

export interface EnrichedPick {
  pick: Pick;
  el: BootstrapElement | undefined;
  teamShort: string;
  position: string;
  proj: PlayerProjection | undefined;
}

// FPL's standard chip set (Assistant Manager was a 2024-25-only experiment).
const STANDARD_CHIPS: Record<string, string> = {
  wildcard: "Wildcard",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  freehit: "Free Hit",
};

export function useMyTeam(entryId: number | null) {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: fetchBootstrap,
    staleTime: 3 * 60 * 1000,
  });

  const entry = useQuery({
    queryKey: ["entry", entryId],
    queryFn: () => fetchEntry(entryId!),
    enabled: entryId !== null,
  });

  const history = useQuery({
    queryKey: ["entry-history", entryId],
    queryFn: () => fetchEntryHistory(entryId!),
    enabled: entryId !== null,
  });

  // Which gameweek's squad to show: the entry's current event, else bootstrap's.
  const currentGw =
    entry.data?.current_event ??
    bootstrap.data?.events.find((e) => e.is_current)?.id ??
    null;

  const picks = useQuery({
    queryKey: ["picks", entryId, currentGw],
    queryFn: () => fetchPicks(entryId!, currentGw!),
    enabled: entryId !== null && currentGw !== null,
  });

  // Cadence comes from the shared static-bundle policy in main.tsx; polling a
  // build artefact on a timer only re-downloaded an unchanged 400 KB file.
  const projections = useQuery({ queryKey: ["projections"], queryFn: fetchProjections });
  const optimal = useQuery({
    queryKey: ["optimal-squad"],
    queryFn: fetchOptimalSquad,
    staleTime: 30 * 60 * 1000,
  });
  const playersLive = useQuery({
    queryKey: ["players-live"],
    queryFn: fetchPlayersLive,
    staleTime: 30 * 60 * 1000,
  });

  const view = buildView(
    entryId, bootstrap.data, entry.data, picks.data, history.data,
    projections.data, optimal.data, playersLive.data,
  );

  return {
    currentGw,
    isLoading:
      entryId !== null &&
      (bootstrap.isLoading || entry.isLoading || picks.isLoading || history.isLoading),
    error: entry.error ?? picks.error ?? history.error ?? bootstrap.error,
    view,
  };
}

export interface MyTeamView {
  managerName: string;
  teamName: string;
  overallRank: number | null;
  overallPoints: number | null;
  gwPoints: number;
  bankM: number;
  squadValueM: number;
  benchPoints: number;
  chipsUsed: { label: string; event: number }[];
  chipsAvailable: string[];
  rows: EnrichedPick[][]; // XI grouped GKP/DEF/MID/FWD
  bench: EnrichedPick[];
  modelNextGw: { xp: number; low: number; high: number; covered: number; total: number };
  modelNext5: number;
  rating: TeamRating | null;
  suggestions: TransferSuggestion[];
  activeChip: string | null;
  /** Gameweeks the projections cover, for the gameweek selector. */
  horizon: number[];
  /** element -> gw -> projected xP, so any future gameweek can be shown. */
  perGw: Map<number, Map<number, number>>;
  /** Projected XI total (captain doubled) for each gameweek in the horizon. */
  totalsByGw: Map<number, number>;
  chipPlan: ChipSuggestion[];
}

function enrich(
  pick: Pick,
  byId: Map<number, BootstrapElement>,
  teams: Map<number, string>,
  proj: Projections | undefined,
): EnrichedPick {
  const el = byId.get(pick.element);
  return {
    pick,
    el,
    teamShort: el ? (teams.get(el.team) ?? "?") : "?",
    position: el ? (POSITION_BY_TYPE[el.element_type] ?? "?") : "?",
    proj: proj?.players[String(pick.element)],
  };
}

function buildView(
  entryId: number | null,
  bootstrap: Bootstrap | undefined,
  entry: EntrySummary | undefined,
  picks: EntryPicks | undefined,
  history: EntryHistory | undefined,
  projections: Projections | undefined,
  optimal: OptimalSquad | undefined,
  playersLive: PlayerLive[] | undefined,
): MyTeamView | null {
  if (entryId === null || !bootstrap || !entry || !picks) return null;

  const byId = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teams = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  const enriched = picks.picks.map((p) => enrich(p, byId, teams, projections));
  const xi = enriched.filter((e) => e.pick.position <= 11);
  const bench = enriched
    .filter((e) => e.pick.position > 11)
    .sort((a, b) => a.pick.position - b.pick.position);

  const order = ["GKP", "DEF", "MID", "FWD"];
  const rows = order
    .map((pos) => xi.filter((e) => e.position === pos))
    .filter((r) => r.length > 0);

  // Our model's next-GW projection (captain doubled), summed over the XI. The
  // team band combines per-player variances in quadrature — NOT by summing the
  // per-player 10/90 percentiles, which would wrongly assume every player peaks
  // or bombs together. Z10_90 spans ~2.563 sigma.
  const Z = 1.2816;
  const SPAN = 2 * Z;
  let variance = 0;
  let covered = 0;
  const modelXp = xi.reduce((sum, e) => {
    const ng = e.proj?.next_gw;
    if (!ng) return sum;
    covered += 1;
    const mult = e.pick.is_captain ? 2 : 1;
    const sigma = Math.max(0, (ng.high - ng.low) / SPAN);
    variance += (sigma * mult) ** 2;
    return sum + ng.xp * mult;
  }, 0);
  const teamSigma = Math.sqrt(variance);
  const mLow = Math.max(0, modelXp - Z * teamSigma);
  const mHigh = modelXp + Z * teamSigma;
  const modelNext5 = xi.reduce((sum, e) => sum + (e.proj?.next5_xp ?? 0), 0);

  // Team rating + transfer suggestions, benchmarked against the optimal squad.
  const squadMembers: SquadMember[] = enriched.map((e) => ({
    element: e.pick.element,
    position: (e.position as Position),
    team: e.teamShort,
    price: e.el ? e.el.now_cost / 10 : 0,
    next5: e.proj?.next5_xp ?? 0,
    isCaptain: e.pick.is_captain,
    isStart: e.pick.position <= 11,
  }));
  const rating = optimal ? computeTeamRating(squadMembers, optimal) : null;
  const suggestions =
    projections && playersLive
      ? suggestTransfers(
          squadMembers,
          buildCandidates(playersLive, projections),
          picks.entry_history.bank / 10,
        )
      : [];

  // Per-gameweek projections for every squad member, so the screen can be
  // pointed at a future gameweek instead of only the next one.
  const horizon = projections?.horizon ?? [];
  const perGw = new Map<number, Map<number, number>>();
  for (const e of enriched) {
    const m = new Map<number, number>();
    for (const g of e.proj?.per_gw ?? []) m.set(g.gw, g.xp);
    perGw.set(e.pick.element, m);
  }
  const totalsByGw = new Map<number, number>();
  for (const gw of horizon) {
    const total = xi.reduce((sum, e) => {
      const xp = perGw.get(e.pick.element)?.get(gw) ?? 0;
      return sum + xp * (e.pick.is_captain ? 2 : 1);
    }, 0);
    totalsByGw.set(gw, Math.round(total * 10) / 10);
  }

  const usedNames = new Set((history?.chips ?? []).map((c) => c.name));
  const chipsUsed = (history?.chips ?? []).map((c) => ({
    label: STANDARD_CHIPS[c.name] ?? c.name,
    event: c.event,
  }));
  const chipsAvailable = Object.entries(STANDARD_CHIPS)
    .filter(([key]) => !usedNames.has(key))
    .map(([, label]) => label);

  return {
    managerName: `${entry.player_first_name} ${entry.player_last_name}`,
    teamName: entry.name,
    overallRank: entry.summary_overall_rank,
    overallPoints: entry.summary_overall_points,
    gwPoints: picks.entry_history.points,
    bankM: picks.entry_history.bank / 10,
    squadValueM: picks.entry_history.value / 10,
    benchPoints: picks.entry_history.points_on_bench,
    chipsUsed,
    chipsAvailable,
    rows,
    bench,
    modelNextGw: {
      xp: Math.round(modelXp * 10) / 10,
      low: Math.round(mLow * 10) / 10,
      high: Math.round(mHigh * 10) / 10,
      covered,
      total: xi.length,
    },
    modelNext5: Math.round(modelNext5 * 10) / 10,
    rating,
    suggestions,
    horizon,
    perGw,
    totalsByGw,
    chipPlan: suggestChips({
      perGw: enriched.map((e) => ({
        element: e.pick.element,
        isStart: e.pick.position <= 11,
        gws: perGw.get(e.pick.element) ?? new Map(),
      })),
      horizon,
      available: chipsAvailable,
    }),
    activeChip: picks.active_chip
      ? (STANDARD_CHIPS[picks.active_chip] ?? picks.active_chip)
      : null,
  };
}
