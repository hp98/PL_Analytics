// The Explorer's filter model and its translation to SQL over mart_player_form.

import { sqlString } from "../../lib/sql";
import type { Position } from "../../lib/types";

export type NumericOp = ">=" | "<=" | ">" | "<" | "=";

export interface ExplorerFilters {
  season: string;
  search: string;
  positions: Position[]; // empty => the four outfield/keeper positions (no MNG)
  teams: string[]; // team_name list; empty => all
  priceMin: number | null;
  priceMax: number | null;
  minMinutes: number | null; // season_minutes >=
  statColumn: string | null; // any numeric column key
  statOp: NumericOp;
  statValue: number | null;
}

export function defaultFilters(season: string): ExplorerFilters {
  return {
    season,
    search: "",
    positions: [],
    teams: [],
    priceMin: null,
    priceMax: null,
    minMinutes: null,
    statColumn: null,
    statOp: ">=",
    statValue: null,
  };
}

const OUTFIELD: Position[] = ["GKP", "DEF", "MID", "FWD"];

// Build the SQL WHERE body (without the leading WHERE) for the given filters.
export function buildWhere(f: ExplorerFilters): string {
  const preds: string[] = [`season = ${sqlString(f.season)}`];

  const positions = f.positions.length > 0 ? f.positions : OUTFIELD;
  preds.push(`position in (${positions.map(sqlString).join(", ")})`);

  if (f.search.trim()) {
    preds.push(`lower(name) like ${sqlString(`%${f.search.trim().toLowerCase()}%`)}`);
  }
  if (f.teams.length > 0) {
    preds.push(`team_name in (${f.teams.map(sqlString).join(", ")})`);
  }
  if (f.priceMin !== null) preds.push(`price_m >= ${f.priceMin}`);
  if (f.priceMax !== null) preds.push(`price_m <= ${f.priceMax}`);
  if (f.minMinutes !== null) preds.push(`season_minutes >= ${f.minMinutes}`);
  if (f.statColumn && f.statValue !== null && Number.isFinite(f.statValue)) {
    // statColumn is validated against the known column allowlist by the UI.
    preds.push(`${f.statColumn} ${f.statOp} ${f.statValue}`);
  }
  return preds.join(" AND ");
}

// Text columns sort case-insensitively; DuckDB's default collation would put
// every uppercase name ahead of every lowercase one.
const TEXT_COLUMNS = new Set(["name", "team_name", "position"]);

export function buildExplorerSql(f: ExplorerFilters, orderBy: string, desc: boolean): string {
  const key = TEXT_COLUMNS.has(orderBy) ? `lower(${orderBy})` : orderBy;
  return `
    select * from read_parquet('mart_player_form.parquet')
    where ${buildWhere(f)}
    order by ${key} ${desc ? "desc" : "asc"} nulls last
  `;
}
