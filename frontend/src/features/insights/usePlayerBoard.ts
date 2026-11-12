import { useQuery } from "@tanstack/react-query";

import { fetchPlayersLive, fetchProjections } from "../../lib/api";
import type { Position } from "../../lib/types";

export interface BoardPlayer {
  element: number;
  name: string;
  position: Position;
  team: string;
  price: number;
  ownership: number; // %
  xpNext: number;
  next5: number;
  pHaul: number; // P(>=10)
  pReturn: number; // P(>=5)
}

/** Joined per-player board from projections (xp, haul odds) + live (price,
 * ownership, team). Backs the Captaincy and Differentials screens. */
export function usePlayerBoard() {
  const projections = useQuery({
    queryKey: ["projections"],
    queryFn: fetchProjections,
    staleTime: 5 * 60_000,
  });
  const players = useQuery({
    queryKey: ["players-live"],
    queryFn: fetchPlayersLive,
    staleTime: 60_000,
  });

  const board: BoardPlayer[] = [];
  if (projections.data && players.data) {
    for (const p of players.data) {
      if (!p.position || !["a", "d"].includes(p.status)) continue;
      const proj = projections.data.players[String(p.element)];
      const ng = proj?.next_gw;
      board.push({
        element: p.element,
        name: p.web_name,
        position: p.position,
        team: p.team_short ?? "?",
        price: p.price_m,
        ownership: p.ownership_pct,
        xpNext: ng?.xp ?? 0,
        next5: proj?.next5_xp ?? 0,
        pHaul: ng?.p_haul ?? 0,
        pReturn: ng?.p_return ?? 0,
      });
    }
  }

  return {
    board,
    isLoading: projections.isLoading || players.isLoading,
    isError: projections.isError || players.isError,
  };
}
