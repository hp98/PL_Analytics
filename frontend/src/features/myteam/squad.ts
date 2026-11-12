import type { Position } from "../../lib/types";

/**
 * Squad valuation by best legal XI.
 *
 * FPL only scores your starting eleven (plus auto-subs), and doubles the
 * captain. Valuing a squad by summing all fifteen — as this used to — inflates
 * every total and, worse, lets a planner "upgrade" a bench slot for a gain that
 * can never be realised. Everything that puts a number on a squad should go
 * through here.
 */

export interface Formation {
  def: number;
  mid: number;
  fwd: number;
}

/** Every legal FPL shape: 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD, 11 total. */
export const FORMATIONS: Formation[] = (() => {
  const out: Formation[] = [];
  for (let def = 3; def <= 5; def += 1) {
    for (let mid = 2; mid <= 5; mid += 1) {
      const fwd = 10 - def - mid;
      if (fwd >= 1 && fwd <= 3) out.push({ def, mid, fwd });
    }
  }
  return out;
})();

export const formationLabel = (f: Formation): string => `${f.def}-${f.mid}-${f.fwd}`;

export interface HasPosition {
  position: Position;
}

export interface XiSelection<T> {
  xi: T[];
  bench: T[];
  formation: Formation | null;
  /** XI total for this gameweek, captain already doubled when asked for. */
  total: number;
  captain: T | null;
}

const byPos = <T extends HasPosition>(players: T[], pos: Position): T[] =>
  players.filter((p) => p.position === pos);

/**
 * Pick the highest-scoring legal XI for a single gameweek.
 *
 * Exhaustive over the eight legal formations — each is just "take the top N per
 * position", so the best XI is the best of eight sorted prefixes. Cheap enough
 * to run per gameweek per candidate swap.
 */
export function pickBestXi<T extends HasPosition>(
  players: T[],
  xpOf: (p: T) => number,
  opts: { captain?: boolean } = {},
): XiSelection<T> {
  const sorted = (pos: Position) =>
    byPos(players, pos)
      .slice()
      .sort((a, b) => xpOf(b) - xpOf(a));

  const gk = sorted("GKP");
  const def = sorted("DEF");
  const mid = sorted("MID");
  const fwd = sorted("FWD");

  let best: XiSelection<T> | null = null;
  for (const f of FORMATIONS) {
    if (def.length < f.def || mid.length < f.mid || fwd.length < f.fwd || gk.length < 1) continue;
    const xi = [...gk.slice(0, 1), ...def.slice(0, f.def), ...mid.slice(0, f.mid), ...fwd.slice(0, f.fwd)];
    let total = xi.reduce((sum, p) => sum + xpOf(p), 0);
    let captain: T | null = null;
    if (xi.length > 0) {
      captain = xi.reduce((a, b) => (xpOf(b) > xpOf(a) ? b : a));
      if (opts.captain) total += xpOf(captain);
    }
    if (!best || total > best.total) {
      const chosen = new Set(xi);
      best = { xi, bench: players.filter((p) => !chosen.has(p)), formation: f, total, captain };
    }
  }

  return best ?? { xi: [], bench: [...players], formation: null, total: 0, captain: null };
}

/**
 * Value a 15-man squad over a horizon: for each gameweek, the best legal XI with
 * the captain doubled, summed.
 *
 * The XI is re-picked per gameweek, which is what a manager would actually do —
 * a player blanking in GW5 is benched that week, not carried.
 */
export function squadHorizonXp<T extends HasPosition>(
  squad: T[],
  horizon: number[],
  xpOf: (p: T, gw: number) => number,
): number {
  return horizon.reduce(
    (sum, gw) => sum + pickBestXi(squad, (p) => xpOf(p, gw), { captain: true }).total,
    0,
  );
}
