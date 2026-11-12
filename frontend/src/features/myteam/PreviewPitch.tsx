import { PitchMarkings } from "../../components/PitchMarkings";
import { TeamKit } from "../../components/TeamKit";
import type { Position } from "../../lib/types";
import type { PreviewPlayer } from "./usePreview";

const ORDER: Position[] = ["GKP", "DEF", "MID", "FWD"];

function PreviewChip({
  p, gw, isCaptain, selected, benched, onClick,
}: {
  p: PreviewPlayer;
  gw: number | null;
  isCaptain: boolean;
  selected: boolean;
  benched: boolean;
  onClick: () => void;
}) {
  const xp = gw === null ? null : (p.gws.get(gw) ?? 0);
  return (
    <div className="w-[62px] sm:w-[76px]">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`player-card w-full text-left transition ${
          selected ? "ring-2 ring-brand scale-[1.04]" : "hover:ring-1 hover:ring-brand/50"
        } ${benched ? "opacity-90" : ""}`}
        title={
          selected
            ? "Selected — pick another player to swap, or use the actions below"
            : `${p.name} · ${p.team} · ${p.position}`
        }
      >
        {isCaptain && (
          <span className="absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center bg-brand text-surface-0 shadow">
            C
          </span>
        )}
        <TeamKit team={p.team} isKeeper={p.position === "GKP"} size={40} />
        <div className="player-card__name">{p.name}</div>
        <div className="flex w-full">
          <div className="player-card__value player-card__value--muted !rounded-none !rounded-bl flex-1 !text-[10px]">
            {p.price.toFixed(1)}
          </div>
          <div
            className="player-card__value !rounded-none !rounded-br flex-1"
            title={gw === null ? "" : `Projected points, GW${gw}`}
          >
            {xp === null ? "—" : xp.toFixed(1)}
          </div>
        </div>
      </button>
    </div>
  );
}

export function PreviewPitch({
  xi, bench, gw, captainId, selectedId, onSelect,
}: {
  xi: PreviewPlayer[];
  bench: PreviewPlayer[];
  gw: number | null;
  captainId: number | null;
  selectedId: number | null;
  onSelect: (element: number) => void;
}) {
  const rows = ORDER.map((pos) => xi.filter((p) => p.position === pos)).filter((r) => r.length > 0);
  // Keepers first, then the outfield bench in the order the manager set.
  const benchOrder = [...bench].sort(
    (a, b) => ORDER.indexOf(a.position) - ORDER.indexOf(b.position),
  );

  return (
    <div className="card overflow-hidden">
      <div className="p-3 sm:p-4">
        <div className="pitch-wrap">
          <div className="pitch-bg">
            <PitchMarkings />
            <div className="pitch-rows">
              {rows.map((row, i) => (
                <div key={i} className="pitch-row">
                  {row.map((p) => (
                    <PreviewChip
                      key={p.element}
                      p={p}
                      gw={gw}
                      isCaptain={p.element === captainId}
                      selected={p.element === selectedId}
                      benched={false}
                      onClick={() => onSelect(p.element)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="pitch-bench">
            <div className="text-[10px] uppercase tracking-wide text-white/55 mb-1.5 text-center">
              Bench
            </div>
            <div className="pitch-row">
              {benchOrder.map((p) => (
                <PreviewChip
                  key={p.element}
                  p={p}
                  gw={gw}
                  isCaptain={false}
                  selected={p.element === selectedId}
                  benched
                  onClick={() => onSelect(p.element)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 text-[10px] text-ink-faint flex justify-between">
        <span>Tap a player to select, then tap another to swap them</span>
        <span>
          <span className="text-ink-muted">price</span> ·{" "}
          <span className="text-brand">projected {gw === null ? "" : `GW${gw}`}</span>
        </span>
      </div>
    </div>
  );
}
