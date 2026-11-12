import { useQuery } from "@tanstack/react-query";

import { query, sqlString } from "../../lib/duckdb";
import type { PlayerForm } from "../../lib/types";
import { buildExplorerSql, type ExplorerFilters } from "./filterModel";

export interface ExplorerResult {
  rows: PlayerForm[];
  elapsedMs: number;
}

export function useExplorerData(filters: ExplorerFilters, orderBy: string, desc: boolean) {
  return useQuery({
    queryKey: ["explorer", filters, orderBy, desc],
    queryFn: async (): Promise<ExplorerResult> => {
      const sql = buildExplorerSql(filters, orderBy, desc);
      const t0 = performance.now();
      const rows = await query<PlayerForm>(sql);
      return { rows, elapsedMs: performance.now() - t0 };
    },
    placeholderData: (prev) => prev, // keep old rows visible while refiltering
  });
}

/** Distinct team names for a season, for the team filter options. */
export function useSeasonTeams(season: string) {
  return useQuery({
    queryKey: ["explorer-teams", season],
    queryFn: () =>
      query<{ team_name: string }>(
        `select distinct team_name from read_parquet('mart_player_form.parquet')
         where season = ${sqlString(season)} order by team_name`,
      ).then((r) => r.map((x) => x.team_name)),
  });
}
