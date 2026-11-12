import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  type EntryLeague,
  fetchEntry,
  fetchEventStatus,
  fetchLeagueStandings,
  LEAGUE_PAGE_SIZE,
} from "../lib/fpl";
import { fmtInt } from "../lib/format";
import { useUiStore } from "../store/useUiStore";

function RankMove({ rank, lastRank }: { rank: number; lastRank: number }) {
  const move = lastRank === 0 ? 0 : lastRank - rank;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums">
      <span className="text-ink">{rank}</span>
      {move !== 0 && (
        <span className={`text-[10px] ${move > 0 ? "text-brand" : "text-fdr-5"}`}>
          {move > 0 ? `▲${move}` : `▼${-move}`}
        </span>
      )}
    </span>
  );
}

/** Percentile of the manager's rank within a league.
 *
 * Only shown for leagues big enough for a percentile to mean anything: 1st of 9
 * is "top 11%" arithmetically, which reads worse than the plain rank it already
 * sits next to. Below the threshold the rank/total pair says it better. */
const MIN_ENTRIES_FOR_PERCENTILE = 100;

function standing(l: EntryLeague): string | null {
  if (l.entry_rank === null || !l.rank_count) return null;
  if (l.rank_count < MIN_ENTRIES_FOR_PERCENTILE) {
    return l.entry_rank === 1 ? "1st" : null;
  }
  const pct = Math.max(1, Math.round((l.entry_rank / l.rank_count) * 100));
  return `top ${pct}%`;
}

function LeagueCard({
  league,
  active,
  onPick,
}: {
  league: EntryLeague;
  active: boolean;
  onPick: (id: number) => void;
}) {
  const moved =
    league.entry_last_rank && league.entry_rank
      ? league.entry_last_rank - league.entry_rank
      : 0;
  return (
    <button
      onClick={() => onPick(league.id)}
      className={`text-left rounded-lg border px-3 py-2 transition-colors w-full ${
        active
          ? "border-brand bg-brand-dim/15"
          : "border-surface-3/70 bg-surface-2 hover:border-brand/40"
      }`}
    >
      <div className="text-sm text-ink truncate" title={league.name}>
        {league.name}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5 text-[11px]">
        {league.entry_rank !== null ? (
          <>
            <span className="text-ink font-semibold tabular-nums">
              {fmtInt(league.entry_rank)}
            </span>
            {league.rank_count ? (
              <span className="text-ink-faint">/ {fmtInt(league.rank_count)}</span>
            ) : null}
            {moved !== 0 && (
              <span className={moved > 0 ? "text-brand" : "text-fdr-5"}>
                {moved > 0 ? `▲${moved}` : `▼${-moved}`}
              </span>
            )}
            {standing(league) && (
              <span className="text-ink-faint ml-auto">{standing(league)}</span>
            )}
          </>
        ) : (
          <span className="text-ink-faint">unranked</span>
        )}
      </div>
    </button>
  );
}

function LeagueGroup({
  label,
  leagues,
  active,
  onPick,
}: {
  label: string;
  leagues: EntryLeague[];
  active: number | null;
  onPick: (id: number) => void;
}) {
  if (leagues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">
        {label} <span className="text-ink-faint/70">({leagues.length})</span>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {leagues.map((l) => (
          <LeagueCard key={l.id} league={l} active={active === l.id} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

export function LeaguesRoute() {
  const entryId = useUiStore((s) => s.entryId);
  const myEntry = entryId && /^\d+$/.test(entryId) ? Number(entryId) : null;
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const [page, setPage] = useState(1);

  // Once an entry ID is set, the manager's own leagues load automatically.
  const { data: entry, isLoading: entryLoading } = useQuery({
    queryKey: ["entry", myEntry],
    queryFn: () => fetchEntry(myEntry!),
    enabled: myEntry !== null,
  });
  const allLeagues = entry?.leagues?.classic ?? [];
  // "x" leagues are the ones someone actually created and invited you to; "s"
  // are the global/country/club leagues every manager is enrolled in.
  const miniLeagues = allLeagues.filter((l) => l.league_type === "x");
  const globalLeagues = allLeagues.filter((l) => l.league_type !== "x");

  // Default to a real mini-league (smallest = most personal), not "Overall".
  useEffect(() => {
    if (leagueId !== null || allLeagues.length === 0) return;
    const preferred =
      [...miniLeagues].sort((a, b) => (a.rank_count ?? 1e9) - (b.rank_count ?? 1e9))[0] ??
      allLeagues[0]!;
    setLeagueId(preferred.id);
  }, [allLeagues, miniLeagues, leagueId]);

  const selected = allLeagues.find((l) => l.id === leagueId) ?? null;

  // Big leagues run to thousands of pages, and page 1 is the global top 50 —
  // useless if you sit at rank 43,441. Jump straight to the page you're on.
  useEffect(() => {
    const rank = selected?.entry_rank ?? null;
    setPage(rank && rank > LEAGUE_PAGE_SIZE ? Math.ceil(rank / LEAGUE_PAGE_SIZE) : 1);
  }, [selected]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["league", leagueId, page],
    queryFn: () => fetchLeagueStandings(leagueId!, page),
    enabled: leagueId !== null,
  });

  // FPL re-sorts league tables asynchronously; until that pass runs, standings
  // legitimately lag the live scores. Surfacing it beats looking broken.
  const { data: eventStatus } = useQuery({
    queryKey: ["event-status"],
    queryFn: fetchEventStatus,
    refetchInterval: 120_000,
  });
  const leaguesUpdating = eventStatus ? eventStatus.leagues !== "Updated" : false;

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-ink mr-1">Mini-Leagues</h1>
          <input
            className="input w-40"
            inputMode="numeric"
            placeholder="league ID…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && /^\d+$/.test(manual.trim())) setLeagueId(Number(manual.trim()));
            }}
          />
          <button
            className="btn"
            onClick={() => /^\d+$/.test(manual.trim()) && setLeagueId(Number(manual.trim()))}
          >
            Load
          </button>
        </div>

        {myEntry === null ? (
          <p className="text-xs text-ink-muted">
            Set your entry ID on the{" "}
            <Link to="/my-team" className="text-brand">
              My Team
            </Link>{" "}
            screen and your leagues will load here automatically.
          </p>
        ) : entryLoading ? (
          <div className="skeleton h-8 w-64" />
        ) : allLeagues.length > 0 ? (
          <div className="space-y-3">
            <LeagueGroup
              label="Your mini-leagues"
              leagues={miniLeagues}
              active={leagueId}
              onPick={setLeagueId}
            />
            <LeagueGroup
              label="Global"
              leagues={globalLeagues}
              active={leagueId}
              onPick={setLeagueId}
            />
          </div>
        ) : (
          <p className="text-xs text-ink-muted">No classic leagues found for this entry.</p>
        )}
      </div>

      {isError && (
        <div className="card p-4 text-fdr-5 text-sm">
          Couldn’t load league: {(error as Error).message}
        </div>
      )}
      {isLoading && <div className="skeleton h-64 w-full" />}

      {data && (
        <div className="table-card overflow-hidden">
          <div className="px-3 py-2.5 border-b border-surface-2 flex items-center gap-2 flex-wrap">
            <span className="text-ink font-medium">{data.league.name}</span>
            <span className="text-xs text-ink-faint">
              {data.standings.results.length} shown · page {page}
              {selected?.rank_count
                ? ` of ${Math.max(1, Math.ceil(selected.rank_count / LEAGUE_PAGE_SIZE))}`
                : ""}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                className="btn !py-1 !px-2"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← prev
              </button>
              {selected?.entry_rank && selected.entry_rank > LEAGUE_PAGE_SIZE && (
                <button
                  className="btn !py-1 !px-2"
                  onClick={() => setPage(Math.ceil(selected.entry_rank! / LEAGUE_PAGE_SIZE))}
                  title="Jump to your position"
                >
                  my rank
                </button>
              )}
              <button
                className="btn !py-1 !px-2"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.standings.has_next}
              >
                next →
              </button>
            </div>
          </div>

          {leaguesUpdating && (
            <div className="px-3 py-2 text-[11px] text-fdr-4 bg-fdr-4/10 border-b border-surface-2">
              FPL hasn’t re-sorted league tables for this gameweek yet, so ranks and totals here can
              trail the live scores. It updates once the gameweek is finalised — this isn’t a cached
              copy on our side.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-ink-muted text-xs">
                <tr className="border-b border-surface-2">
                  <th className="text-left px-3 py-2 w-20">Rank</th>
                  <th className="text-left px-3 py-2">Team</th>
                  <th className="text-left px-3 py-2 w-48">Manager</th>
                  <th className="text-right px-3 py-2 w-20">GW</th>
                  <th className="text-right px-3 py-2 w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.standings.results.map((r) => {
                  const isMe = r.entry === myEntry;
                  return (
                    <tr
                      key={r.entry}
                      className={`border-b border-surface-2/40 ${isMe ? "bg-brand-dim/15" : "hover:bg-surface-2"}`}
                    >
                      <td className="px-3 py-2 align-middle">
                        <RankMove rank={r.rank} lastRank={r.last_rank} />
                      </td>
                      <td className="px-3 py-2 align-middle text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="truncate max-w-[280px]">{r.entry_name}</span>
                          {isMe && <span className="pill bg-brand text-surface-0 shrink-0">you</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle text-ink-muted truncate max-w-[200px]">
                        {r.player_name}
                      </td>
                      <td className="px-3 py-2 align-middle text-right tabular-nums text-ink-muted">
                        {r.event_total}
                      </td>
                      <td className="px-3 py-2 align-middle text-right tabular-nums text-ink font-medium">
                        {r.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
