// Typed client for the live FPL data, routed through the edge Worker (which
// adds CORS and caches). In dev the Worker runs at localhost:8787; in prod it
// is same-origin under /api. Only public, read-only endpoints are used.

const WORKER_ORIGIN: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8787" : "");

const workerUrl = (path: string): string => `${WORKER_ORIGIN}${path}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(workerUrl(path));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status} ${detail.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

// --- Bootstrap ------------------------------------------------------------
export interface BootstrapElement {
  id: number;
  web_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  ep_next: string;
  event_points: number;
  total_points: number;
  status: string;
  chance_of_playing_next_round: number | null;
  news: string;
  selected_by_percent: string;
  form: string;
}
export interface BootstrapTeam {
  id: number;
  name: string;
  short_name: string;
}
export interface BootstrapEvent {
  id: number;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
}
export interface Bootstrap {
  elements: BootstrapElement[];
  teams: BootstrapTeam[];
  events: BootstrapEvent[];
}

// --- Entry ----------------------------------------------------------------
export interface EntryLeague {
  id: number;
  name: string;
  entry_rank: number | null;
  entry_last_rank: number | null;
  /** "x" = a mini-league someone created; "s" = a global/system league
   * (Overall, your country, your club) that everyone is enrolled in. */
  league_type: "x" | "s";
  rank_count: number | null;
}

export interface EntrySummary {
  leagues?: { classic: EntryLeague[]; h2h: EntryLeague[] };
  player_first_name: string;
  player_last_name: string;
  name: string;
  summary_overall_rank: number | null;
  summary_overall_points: number | null;
  summary_event_points: number | null;
  current_event: number | null;
  last_deadline_bank: number | null;
  last_deadline_value: number | null;
}
export interface EntryChip {
  name: string;
  event: number;
}
export interface EntryHistoryEvent {
  event: number;
  points: number;
  total_points: number;
  rank: number | null;
  overall_rank: number | null;
  bank: number;
  value: number;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
}
export interface EntryHistory {
  current: EntryHistoryEvent[];
  chips: EntryChip[];
}
export interface Pick {
  element: number;
  position: number; // 1-15 (1-11 XI, 12-15 bench)
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}
export interface EntryPicks {
  active_chip: string | null;
  entry_history: EntryHistoryEvent;
  picks: Pick[];
}

export const POSITION_BY_TYPE: Record<number, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
  5: "MNG",
};

// --- Live gameweek --------------------------------------------------------
export interface LiveStats {
  minutes: number;
  bps: number;
  bonus: number;
  total_points: number;
  goals_scored: number;
  assists: number;
}
export interface LiveElement {
  id: number;
  stats: LiveStats;
  explain: { fixture: number }[];
}
export interface LiveData {
  elements: LiveElement[];
}

export interface FixtureLite {
  id: number;
  event: number | null;
  started: boolean;
  finished: boolean;
  team_h: number;
  team_a: number;
  kickoff_time: string | null;
}

// --- Mini-leagues ---------------------------------------------------------
export interface LeagueStanding {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  last_rank: number;
  total: number;
  event_total: number;
}
export interface LeagueStandings {
  league: { id: number; name: string };
  standings: { results: LeagueStanding[]; has_next: boolean; page?: number };
}

/** FPL's own processing state for the gameweek. `leagues` stays empty until it
 * has re-sorted league tables — which is why some standings lag mid-gameweek. */
export interface EventStatus {
  status: { event: number; date: string; bonus_added: boolean; points: string }[];
  leagues: string;
}

/** 50 managers per standings page, fixed by the FPL API. */
export const LEAGUE_PAGE_SIZE = 50;

/** Club kit image, proxied through the Worker (see worker/src/router.ts). */
export const kitUrl = (teamCode: number, isKeeper = false): string =>
  workerUrl(`/api/kit/${teamCode}${isKeeper ? "/gk" : ""}`);

export const fetchBootstrap = () => getJson<Bootstrap>("/api/bootstrap");
export const fetchLive = (gw: number) => getJson<LiveData>(`/api/live/${gw}`);
export const fetchLeagueStandings = (id: number, page = 1) =>
  getJson<LeagueStandings>(`/api/leagues-classic/${id}/standings?page=${page}`);
export const fetchEventStatus = () => getJson<EventStatus>("/api/event-status");
export const fetchFixturesEvent = (gw: number) =>
  getJson<FixtureLite[]>(`/api/fixtures?event=${gw}`);
export const fetchEntry = (id: number) => getJson<EntrySummary>(`/api/entry/${id}`);
export const fetchEntryHistory = (id: number) => getJson<EntryHistory>(`/api/entry/${id}/history`);
export const fetchPicks = (id: number, gw: number) =>
  getJson<EntryPicks>(`/api/entry/${id}/event/${gw}/picks`);
