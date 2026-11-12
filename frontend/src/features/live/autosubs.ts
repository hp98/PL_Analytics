// Simulated auto-subs + captain→vice fallback, applied only for FINISHED
// fixtures (FPL processes subs after matches end). Returns an effective
// multiplier per pick so the running total can be computed.

import type { Pick } from "../../lib/fpl";
import type { Position } from "../../lib/types";

export interface PickState {
  pick: Pick;
  position: Position;
  played: boolean;
  finished: boolean; // their fixture has finished
}

export interface LineupResult {
  multiplier: Map<number, number>; // element -> effective multiplier
  subs: { inEl: number; outEl: number }[];
  captainEl: number | null;
}

const MIN_XI: Record<Position, number> = { GKP: 1, DEF: 3, MID: 2, FWD: 1, MNG: 0 };

/** A starter is "out" only when their fixture has finished and they played 0'. */
const isOut = (s: PickState): boolean => s.finished && !s.played;

export function resolveLineup(states: PickState[]): LineupResult {
  const byEl = new Map(states.map((s) => [s.pick.element, s]));
  const multiplier = new Map<number, number>();
  for (const s of states) multiplier.set(s.pick.element, s.pick.position <= 11 ? s.pick.multiplier : 0);

  const starters = states.filter((s) => s.pick.position <= 11);
  const bench = states.filter((s) => s.pick.position > 11).sort((a, b) => a.pick.position - b.pick.position);
  const subs: { inEl: number; outEl: number }[] = [];
  const usedBench = new Set<number>();

  // Live XI position counts (active starters keep their slot).
  const counts: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0, MNG: 0 };
  for (const s of starters) if (!isOut(s)) counts[s.position] += 1;

  // Goalkeeper: bench GK can only replace the starting GK.
  const outGk = starters.find((s) => s.position === "GKP" && isOut(s));
  const benchGk = bench.find((s) => s.position === "GKP" && s.played);
  if (outGk && benchGk) {
    multiplier.set(outGk.pick.element, 0);
    multiplier.set(benchGk.pick.element, 1);
    counts.GKP += 1;
    usedBench.add(benchGk.pick.element);
    subs.push({ inEl: benchGk.pick.element, outEl: outGk.pick.element });
  }

  // Outfield: for each out starter (in pick order), find the first eligible bench
  // outfielder that keeps the formation valid.
  for (const out of starters.filter((s) => s.position !== "GKP" && isOut(s))) {
    multiplier.set(out.pick.element, 0);
    for (const b of bench) {
      if (b.position === "GKP" || usedBench.has(b.pick.element) || !b.played) continue;
      // Would adding b keep every minimum satisfiable within an 11-man XI?
      const trial = { ...counts };
      trial[b.position] += 1;
      const total = trial.GKP + trial.DEF + trial.MID + trial.FWD;
      const validMins =
        trial.DEF >= MIN_XI.DEF && trial.MID >= MIN_XI.MID && trial.FWD >= MIN_XI.FWD;
      if (total <= 11 && validMins) {
        counts[b.position] += 1;
        multiplier.set(b.pick.element, 1);
        usedBench.add(b.pick.element);
        subs.push({ inEl: b.pick.element, outEl: out.pick.element });
        break;
      }
    }
  }

  // Captain → vice fallback when the captain did not play (finished, 0').
  let captain = starters.find((s) => s.pick.is_captain) ?? null;
  if (captain && isOut(captain)) {
    const vice = states.find((s) => s.pick.is_vice_captain);
    if (vice && !isOut(vice)) {
      const mult = captain.pick.multiplier; // carry 2x / 3x to the vice
      multiplier.set(captain.pick.element, isOut(captain) ? 0 : 1);
      multiplier.set(vice.pick.element, Math.max(multiplier.get(vice.pick.element) ?? 1, mult));
      captain = vice;
    }
  }

  void byEl;
  return { multiplier, subs, captainEl: captain?.pick.element ?? null };
}
