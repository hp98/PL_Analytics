import { useQuery } from "@tanstack/react-query";

import {
  fetchBootstrap,
  fetchFixturesEvent,
  fetchLive,
  fetchPicks,
  POSITION_BY_TYPE,
} from "../../lib/fpl";
import type { Position } from "../../lib/types";
import { resolveLineup, type PickState } from "./autosubs";
import { computeLiveBonus } from "./bonus";

export interface LivePlayer {
  element: number;
  name: string;
  team: string;
  position: Position;
  minutes: number;
  goals: number;
  assists: number;
  bonus: number;
  bonusProvisional: boolean;
  points: number; // live points incl provisional bonus (before multiplier)
  multiplier: number; // effective (captain/auto-sub applied)
  isCaptain: boolean;
  isStarter: boolean;
  finished: boolean;
}

export interface LiveView {
  gw: number;
  isLive: boolean;
  anyProvisional: boolean;
  runningTotal: number;
  players: LivePlayer[];
  subs: { inName: string; outName: string }[];
}

export function useLive(entryId: number | null) {
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: fetchBootstrap, staleTime: 9e5 });
  const gw =
    bootstrap.data?.events.find((e) => e.is_current)?.id ??
    bootstrap.data?.events.find((e) => e.is_next)?.id ??
    null;

  const fixtures = useQuery({
    queryKey: ["fixtures-event", gw],
    queryFn: () => fetchFixturesEvent(gw!),
    enabled: gw !== null,
  });
  const isLive = (fixtures.data ?? []).some((f) => f.started && !f.finished);

  const live = useQuery({
    queryKey: ["live", gw],
    queryFn: () => fetchLive(gw!),
    enabled: gw !== null,
    // Poll only while a match is in progress; otherwise the data is static.
    refetchInterval: isLive ? 30_000 : false,
  });
  const picks = useQuery({
    queryKey: ["picks", entryId, gw],
    queryFn: () => fetchPicks(entryId!, gw!),
    enabled: entryId !== null && gw !== null,
  });

  const view = buildLiveView(
    gw, isLive, bootstrap.data, live.data, picks.data, fixtures.data,
  );

  return {
    gw,
    isLive,
    isLoading:
      entryId !== null && (bootstrap.isLoading || live.isLoading || picks.isLoading),
    isFetching: live.isFetching,
    error: live.error ?? picks.error ?? bootstrap.error,
    refetch: () => void live.refetch(),
    view,
  };
}

function buildLiveView(
  gw: number | null,
  isLive: boolean,
  bootstrap: Awaited<ReturnType<typeof fetchBootstrap>> | undefined,
  live: Awaited<ReturnType<typeof fetchLive>> | undefined,
  picks: Awaited<ReturnType<typeof fetchPicks>> | undefined,
  fixtures: Awaited<ReturnType<typeof fetchFixturesEvent>> | undefined,
): LiveView | null {
  if (gw === null || !bootstrap || !live || !picks) return null;

  const liveByEl = new Map(live.elements.map((e) => [e.id, e]));
  const bonusByEl = computeLiveBonus(live.elements);
  const finishedByFixture = new Map((fixtures ?? []).map((f) => [f.id, f.finished]));
  const elById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teamShort = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  const states: PickState[] = picks.picks.map((p) => {
    const le = liveByEl.get(p.element);
    const fixture = le?.explain[0]?.fixture;
    const bootEl = elById.get(p.element);
    return {
      pick: p,
      position: (bootEl ? POSITION_BY_TYPE[bootEl.element_type] : "MID") as Position,
      played: (le?.stats.minutes ?? 0) > 0,
      finished: fixture !== undefined ? (finishedByFixture.get(fixture) ?? false) : false,
    };
  });

  const lineup = resolveLineup(states);
  const nameOf = (el: number) => elById.get(el)?.web_name ?? `#${el}`;

  const players: LivePlayer[] = states.map((s) => {
    const le = liveByEl.get(s.pick.element);
    const b = bonusByEl.get(s.pick.element) ?? { bonus: 0, provisional: false };
    const base = le?.stats.total_points ?? 0;
    const points = base + (b.provisional ? b.bonus : 0);
    const bootEl = elById.get(s.pick.element);
    return {
      element: s.pick.element,
      name: nameOf(s.pick.element),
      team: bootEl ? (teamShort.get(bootEl.team) ?? "?") : "?",
      position: s.position,
      minutes: le?.stats.minutes ?? 0,
      goals: le?.stats.goals_scored ?? 0,
      assists: le?.stats.assists ?? 0,
      bonus: b.bonus,
      bonusProvisional: b.provisional,
      points,
      multiplier: lineup.multiplier.get(s.pick.element) ?? 0,
      isCaptain: lineup.captainEl === s.pick.element,
      isStarter: s.pick.position <= 11,
      finished: s.finished,
    };
  });

  const runningTotal = players.reduce((sum, p) => sum + p.points * p.multiplier, 0);
  const anyProvisional = players.some((p) => p.bonusProvisional);

  return {
    gw,
    isLive,
    anyProvisional,
    runningTotal,
    players,
    subs: lineup.subs.map((s) => ({ inName: nameOf(s.inEl), outName: nameOf(s.outEl) })),
  };
}
