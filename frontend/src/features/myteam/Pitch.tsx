import { PitchMarkings } from "../../components/PitchMarkings";
import { TeamKit } from "../../components/TeamKit";
import type { LivePlayer } from "../live/useLive";
import type { EnrichedPick } from "./useMyTeam";

interface ChipProps {
  ep: EnrichedPick;
  benched?: boolean;
  /** Live scoring for this player when a gameweek is in play. */
  live?: LivePlayer | undefined;
  /** A future gameweek to preview instead of the current one. */
  futureGw?: number | null;
}

function PlayerChip({ ep, benched = false, live, futureGw = null }: ChipProps) {
  const el = ep.el;
  const name = el?.web_name ?? `#${ep.pick.element}`;
  // FPL sets multiplier 0 for the bench, so multiplying would report 0 for every
  // benched player regardless of what they actually scored. Show what they
  // really scored; only players actually counting get their multiplier applied.
  // During a live gameweek the live feed wins: it includes provisional bonus and
  // has auto-subs already resolved.
  const gwPts = live
    ? live.points * Math.max(live.multiplier, 1)
    : el
      ? el.event_points * Math.max(ep.pick.multiplier, 1)
      : 0;
  const ng = ep.proj?.next_gw;
  const injured = el && el.status !== "a";
  // In future-gameweek mode the left cell shows that gameweek's fixture rather
  // than points that don't exist yet.
  const future = futureGw
    ? (ep.proj?.per_gw.find((g) => g.gw === futureGw) ?? null)
    : null;

  // Provenance tooltip: exactly where the projected number comes from (§9).
  const projTitle = ng
    ? `Projected next GW ${ng.xp.toFixed(1)} (range ${ng.low.toFixed(1)}–${ng.high.toFixed(1)}) vs ${ng.opp} ${ng.home ? "H" : "A"}\n` +
      `= appearance ${ng.components.app.toFixed(1)} + attack ${ng.components.atk.toFixed(1)} + clean sheet ${ng.components.cs.toFixed(1)} + bonus ${ng.components.bon.toFixed(1)}`
    : "No projection for the next gameweek";

  return (
    <div className="w-[62px] sm:w-[76px]">
      <div className="player-card" title={projTitle}>
        {(ep.pick.is_captain || ep.pick.is_vice_captain) && (
          <span
            className={`absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shadow ${
              ep.pick.is_captain
                ? "bg-brand text-surface-0"
                : "bg-surface-1 text-ink border border-surface-3"
            }`}
            title={ep.pick.is_captain ? "Captain" : "Vice-captain"}
          >
            {ep.pick.is_captain ? "C" : "V"}
          </span>
        )}
        {injured && (
          <span className="absolute -top-1 -left-1 z-10 text-[11px]" title={el?.news || "Doubtful"}>
            ⚠️
          </span>
        )}

        <TeamKit team={ep.teamShort} isKeeper={ep.position === "GKP"} size={40} />

        <div className="player-card__name">{name}</div>
        <div className="flex w-full">
          {future ? (
            <>
              <div
                className="player-card__value player-card__value--muted !rounded-none !rounded-bl flex-1 !text-[10px]"
                title={`GW${future.gw} fixture`}
              >
                {future.opp.slice(0, 7)} {future.home ? "H" : "A"}
              </div>
              <div
                className="player-card__value !rounded-none !rounded-br flex-1"
                title={`Projected points, GW${future.gw}`}
              >
                {future.xp.toFixed(1)}
              </div>
            </>
          ) : (
          <>
          <div
            className="player-card__value player-card__value--muted !rounded-none !rounded-bl flex-1"
            title={
              benched && (live ? live.multiplier === 0 : true)
                ? "Points scored (not counted — benched)"
                : live?.bonusProvisional
                  ? "Live points, including provisional bonus from BPS"
                  : "Points this gameweek"
            }
          >
            {gwPts}
            {live?.bonusProvisional ? <span className="text-fdr-4">*</span> : null}
          </div>
          <div
            className="player-card__value !rounded-none !rounded-br flex-1"
            title="Projected points, next gameweek"
          >
            {ng ? ng.xp.toFixed(1) : "—"}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Pitch({
  rows,
  bench,
  live,
  futureGw = null,
}: {
  rows: EnrichedPick[][];
  bench: EnrichedPick[];
  /** element id -> live scoring, present only during a live gameweek. */
  live?: Map<number, LivePlayer>;
  /** When set, preview this future gameweek instead of the current one. */
  futureGw?: number | null;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="p-3 sm:p-4">
        <div className="pitch-wrap">
          <div className="pitch-bg">
            <PitchMarkings />
            <div className="pitch-rows">
              {rows.map((row, i) => (
                <div key={i} className="pitch-row">
                  {row.map((ep) => (
                    <PlayerChip
                      key={ep.pick.element}
                      ep={ep}
                      live={futureGw ? undefined : live?.get(ep.pick.element)}
                      futureGw={futureGw}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Bench continues the same turf surface so it reads as one component
              rather than a differently-styled panel bolted underneath. */}
          <div className="pitch-bench">
            <div className="text-[10px] uppercase tracking-wide text-white/55 mb-1.5 text-center">
              Bench
            </div>
            <div className="pitch-row">
              {bench.map((ep) => (
                <PlayerChip
                  key={ep.pick.element}
                  ep={ep}
                  benched
                  live={futureGw ? undefined : live?.get(ep.pick.element)}
                  futureGw={futureGw}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 text-[10px] text-ink-faint flex justify-between">
        <span>Hover a player for the projection breakdown</span>
        <span>
          {futureGw ? (
            <>
              <span className="text-ink-muted">fixture</span> ·{" "}
              <span className="text-brand">projected GW{futureGw}</span>
            </>
          ) : (
            <>
              <span className="text-ink-muted">GW pts</span> ·{" "}
              <span className="text-brand">projected next GW</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
