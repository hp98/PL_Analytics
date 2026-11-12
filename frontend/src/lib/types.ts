// Types mirroring the static bundles emitted by pipeline/publish.py.

export type Position = "GKP" | "DEF" | "MID" | "FWD" | "MNG";

export interface ModelSummary {
  ship_model: boolean;
  verdict: string;
  model_spearman: number;
  best_baseline: string;
  best_baseline_spearman: number;
  seasons: string[];
}

export interface Manifest {
  build_timestamp: string;
  git_sha: string;
  data_as_of: string | null;
  data_as_of_gw: number | null;
  current_season: string;
  current_gw: number | null;
  next_gw: number | null;
  seasons: string[];
  parquet_tables: { name: string; rows: number; bytes: number }[];
  json_bundles: { name: string; bytes: number }[];
  model: ModelSummary | null;
}

// One row of mart_player_form (the Explorer's backing table).
export interface PlayerForm {
  player_nk: string;
  season: string;
  element: number;
  name: string;
  position: Position;
  team_name: string;
  latest_gw: number;
  price_m: number;
  selected_latest: number;
  points_last3: number;
  points_last6: number;
  points_last10: number;
  points_per90_last6: number | null;
  xgi_per90_last6: number | null;
  xg_per90_last6: number | null;
  xa_per90_last6: number | null;
  bps_per90_last6: number | null;
  minutes_reliability_last6: number | null;
  season_appearances: number;
  season_points: number;
  season_minutes: number;
  season_goals: number;
  season_assists: number;
  season_clean_sheets: number;
  season_goals_conceded: number;
  season_bonus: number;
  season_bps: number;
  season_ict: number;
  season_xg: number;
  season_xa: number;
  season_xgi: number;
  season_xgc: number;
  season_transfers_in: number;
  season_transfers_out: number;
  points_per_appearance: number | null;
}

// One player-fixture row of fct_player_gameweek (drill-down charts).
export interface PlayerGameweek {
  season: string;
  gw: number;
  element: number;
  name: string;
  team_name: string;
  opponent_team_id: number;
  was_home: boolean;
  minutes: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  bonus: number;
  bps: number;
  expected_goals: number | null;
  expected_assists: number | null;
  value: number;
  price_m: number;
}

export interface TickerCell {
  opp_id: number;
  opp_short: string;
  home: boolean;
  official_fdr: number | null;
  attack_fdr: number;
  defence_fdr: number;
  kickoff: string | null;
  finished: boolean;
}

export interface TickerTeam {
  team_id: number;
  name: string;
  short_name: string;
  cells: Record<string, TickerCell[]>;
  num_fixtures: number;
  sum_official_fdr: number | null;
  avg_official_fdr: number | null;
}

export interface FixtureTicker {
  generated_at: string;
  current_gw: number | null;
  next_gw: number | null;
  horizon: number[];
  teams: TickerTeam[];
}

export type FdrMode = "official" | "attack" | "defence";

// --- Projections (model output) ------------------------------------------
export interface ProjectionNextGw {
  gw: number;
  xp: number;
  low: number;
  high: number;
  opp: string;
  home: boolean;
  p_haul: number; // P(returns >= 10)
  p_return: number; // P(>= 5)
  components: { app: number; atk: number; cs: number; bon: number };
}
export interface PlayerProjection {
  web_name: string;
  position: Position;
  next_gw: ProjectionNextGw | null;
  next5_xp: number;
  per_gw: { gw: number; xp: number; opp: string; home: boolean }[];
}
export interface Projections {
  horizon: number[];
  players: Record<string, PlayerProjection>;
}

// --- Optimiser output -----------------------------------------------------
export interface OptimalPick {
  element: number;
  web_name: string;
  position: Position;
  team: string;
  price: number;
  xp: number; // horizon (5-GW) projected points
  is_start: boolean;
  is_captain: boolean;
}
export interface OptimalSquad {
  horizon: number[];
  xi_xp: number;
  cost: number;
  bank: number;
  status: string;
  picks: OptimalPick[];
}

// --- Team identity (official badge code) ----------------------------------
export interface TeamInfo {
  id: number | null;
  code: number; // indexes the official Premier League badge CDN
  name: string;
  short_name: string | null;
  current?: boolean;
}

// --- Price predictor ------------------------------------------------------
export interface PricePrediction {
  element: number;
  web_name: string;
  team: string;
  position: Position | null;
  price_m: number;
  ownership_pct: number;
  net_transfers: number;
  already_changed: number;
  p_rise: number;
  p_fall: number;
}

// --- Live players (current-season overlay) --------------------------------
export interface PlayerLive {
  element: number;
  web_name: string;
  team_short: string | null;
  position: Position | null;
  price_m: number;
  ownership_pct: number;
  status: string;
}
