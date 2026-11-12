// Column metadata for the Explorer table + the numeric-filter dropdown.
// `help` explains provenance so no number is opaque (§9).

import type { PlayerForm } from "../../lib/types";

export interface ColumnMeta {
  key: keyof PlayerForm;
  header: string;
  dp?: number; // decimal places; omit => integer
  numeric: boolean; // available as a numeric filter target
  compact?: boolean; // large counts: show "3.17M", exact value on hover
  help: string;
  width?: number;
}

export const EXPLORER_COLUMNS: ColumnMeta[] = [
  { key: "season_points", header: "Pts", numeric: true, help: "Total FPL points this season.", width: 64 },
  { key: "points_per_appearance", header: "Pts/app", dp: 2, numeric: true, help: "Season points divided by appearances.", width: 74 },
  { key: "season_minutes", header: "Mins", numeric: true, help: "Total minutes played this season.", width: 70 },
  { key: "minutes_reliability_last6", header: "Mins rel.", dp: 2, numeric: true, help: "Fraction of last 6 appearances with 60+ minutes — a start-security signal.", width: 78 },
  { key: "points_last6", header: "Form (6)", numeric: true, help: "Points over the last 6 appearances.", width: 74 },
  { key: "points_per90_last6", header: "Pts/90", dp: 2, numeric: true, help: "Points per 90 minutes over the last 6 appearances.", width: 72 },
  { key: "season_goals", header: "G", numeric: true, help: "Goals scored this season.", width: 52 },
  { key: "season_assists", header: "A", numeric: true, help: "Assists this season.", width: 52 },
  { key: "season_xg", header: "xG", dp: 2, numeric: true, help: "Expected goals this season (FPL feed; 2022-23+).", width: 62 },
  { key: "season_xa", header: "xA", dp: 2, numeric: true, help: "Expected assists this season (FPL feed; 2022-23+).", width: 62 },
  { key: "season_xgi", header: "xGI", dp: 2, numeric: true, help: "Expected goal involvements (xG + xA) this season.", width: 66 },
  { key: "xgi_per90_last6", header: "xGI/90", dp: 2, numeric: true, help: "Expected goal involvements per 90 over the last 6 appearances.", width: 74 },
  { key: "season_clean_sheets", header: "CS", numeric: true, help: "Clean sheets this season.", width: 52 },
  { key: "season_bonus", header: "Bns", numeric: true, help: "Bonus points accrued this season.", width: 58 },
  { key: "season_bps", header: "BPS", numeric: true, help: "Total Bonus Points System score this season.", width: 64 },
  { key: "season_ict", header: "ICT", dp: 1, numeric: true, help: "Cumulative ICT index (Influence, Creativity, Threat).", width: 66 },
  { key: "selected_latest", header: "Selected", numeric: true, compact: true, help: "Managers selecting the player at the latest gameweek (ownership proxy). Hover for the exact count.", width: 84 },
  { key: "season_transfers_in", header: "T-in", numeric: true, compact: true, help: "Total transfers in across the season. Hover for the exact count.", width: 74 },
];

// Numeric columns usable as a filter target (key -> label).
export const NUMERIC_FILTER_COLUMNS = EXPLORER_COLUMNS.filter((c) => c.numeric).map((c) => ({
  key: c.key,
  label: c.header,
}));
