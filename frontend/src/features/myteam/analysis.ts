// Team rating + transfer suggestions, benchmarked against the optimiser's
// optimal squad. Pure functions so they are unit-testable and explainable — the
// rating is never an unexplained number (§9): each sub-score carries its detail.

import type { OptimalSquad, PlayerLive, Position, Projections } from "../../lib/types";
import { pickBestXi, squadHorizonXp } from "./squad";

export interface SubScore {
  label: string;
  score: number; // 0-100
  detail: string;
}
export interface TeamRating {
  overall: number;
  subs: SubScore[];
}

export interface TransferSuggestion {
  outElement: number;
  outName: string;
  outTeam: string;
  inElement: number;
  inName: string;
  inTeam: string;
  position: Position;
  delta: number; // next-5 xP gained
  costChange: number; // £m (positive = spends bank)
}

// A squad player as seen by the analysis (element + its projection).
export interface SquadMember {
  element: number;
  position: Position;
  team: string;
  price: number;
  next5: number;
  isCaptain: boolean;
  isStart: boolean;
}

const clamp100 = (x: number): number => Math.max(0, Math.min(100, Math.round(x)));

export function computeTeamRating(squad: SquadMember[], optimal: OptimalSquad): TeamRating {
  const xi = squad.filter((p) => p.isStart);
  const bench = squad.filter((p) => !p.isStart);
  const cap = xi.find((p) => p.isCaptain);
  const userXi5 = xi.reduce((s, p) => s + p.next5, 0) + (cap ? cap.next5 : 0);
  const userBench5 = bench.reduce((s, p) => s + p.next5, 0);
  const userCost = squad.reduce((s, p) => s + p.price, 0);

  const optStarters = optimal.picks.filter((p) => p.is_start);
  const optBench = optimal.picks.filter((p) => !p.is_start);
  const optBench5 = optBench.reduce((s, p) => s + p.xp, 0);
  const optXi5 = optimal.xi_xp;

  const projection = clamp100((userXi5 / Math.max(optXi5, 1)) * 100);
  const userEff = userXi5 / Math.max(userCost, 1);
  const optEff = optXi5 / Math.max(optimal.cost, 1);
  const value = clamp100((userEff / Math.max(optEff, 1e-6)) * 100);
  const benchScore = clamp100((userBench5 / Math.max(optBench5, 1)) * 100);

  const overall = clamp100(0.6 * projection + 0.25 * value + 0.15 * benchScore);
  void optStarters;
  return {
    overall,
    subs: [
      {
        label: "Projected points",
        score: projection,
        detail: `Your XI (captain doubled) projects ${userXi5.toFixed(1)} over the next 5 GWs vs the optimal squad's ${optXi5.toFixed(1)}.`,
      },
      {
        label: "Value efficiency",
        score: value,
        detail: `${userEff.toFixed(2)} projected pts per £m vs the optimal ${optEff.toFixed(2)}.`,
      },
      {
        label: "Bench strength",
        score: benchScore,
        detail: `Bench projects ${userBench5.toFixed(1)} vs the optimal bench's ${optBench5.toFixed(1)} over 5 GWs.`,
      },
    ],
  };
}

export interface Candidate {
  element: number;
  web_name: string;
  position: Position;
  team: string;
  price: number;
  next5: number;
}

/** Greedy single-transfer suggestions maximising next-5 xP gain (§7 mode 2,
 * approximated client-side). Selling price is approximated by current price
 * (the public API does not expose per-pick purchase price). */
export function suggestTransfers(
  squad: SquadMember[],
  candidates: Candidate[],
  bank: number,
  maxSuggestions = 3,
): TransferSuggestion[] {
  const owned = new Set(squad.map((p) => p.element));
  const clubCounts = new Map<string, number>();
  for (const p of squad) clubCounts.set(p.team, (clubCounts.get(p.team) ?? 0) + 1);

  const byPos = new Map<Position, Candidate[]>();
  for (const c of candidates) {
    if (owned.has(c.element)) continue;
    const arr = byPos.get(c.position) ?? [];
    arr.push(c);
    byPos.set(c.position, arr);
  }
  for (const arr of byPos.values()) arr.sort((a, b) => b.next5 - a.next5);

  const suggestions: TransferSuggestion[] = [];
  for (const out of squad) {
    const pool = byPos.get(out.position) ?? [];
    for (const cand of pool) {
      if (cand.price > bank + out.price) continue;
      const clubAfter =
        (clubCounts.get(cand.team) ?? 0) - (out.team === cand.team ? 1 : 0) + 1;
      if (clubAfter > 3) continue;
      const delta = cand.next5 - out.next5;
      if (delta <= 0) break; // pool is sorted; nothing better remains for this out
      suggestions.push({
        outElement: out.element,
        outName: squadName(out, candidates),
        outTeam: out.team,
        inElement: cand.element,
        inName: cand.web_name,
        inTeam: cand.team,
        position: out.position,
        delta: Math.round(delta * 10) / 10,
        costChange: Math.round((cand.price - out.price) * 10) / 10,
      });
      break; // best single upgrade for this out player
    }
  }
  // Keep the highest-delta suggestions, but never recommend buying the same
  // player (or selling the same player) twice.
  const usedIn = new Set<number>();
  const usedOut = new Set<number>();
  const result: TransferSuggestion[] = [];
  for (const s of suggestions.sort((a, b) => b.delta - a.delta)) {
    if (usedIn.has(s.inElement) || usedOut.has(s.outElement)) continue;
    usedIn.add(s.inElement);
    usedOut.add(s.outElement);
    result.push(s);
    if (result.length >= maxSuggestions) break;
  }
  return result;
}

function squadName(member: SquadMember, candidates: Candidate[]): string {
  return candidates.find((c) => c.element === member.element)?.web_name ?? `#${member.element}`;
}

// Build the analysis candidate list from live players + projections.
export function buildCandidates(
  players: PlayerLive[],
  projections: Projections,
): Candidate[] {
  const out: Candidate[] = [];
  for (const p of players) {
    if (!p.position || !["a", "d"].includes(p.status)) continue;
    const proj = projections.players[String(p.element)];
    out.push({
      element: p.element,
      web_name: p.web_name,
      position: p.position,
      team: p.team_short ?? "?",
      price: p.price_m,
      next5: proj?.next5_xp ?? 0,
    });
  }
  return out;
}


// --- Chip strategy ---------------------------------------------------------

export interface ChipSuggestion {
  chip: string;
  gw: number;
  detail: string;
  value: number;
}

export interface ChipInput {
  /** Projected xP per gameweek for each squad member. */
  perGw: { element: number; isStart: boolean; gws: Map<number, number> }[];
  horizon: number[];
  available: string[];
}

/** Where each remaining chip looks best over the projected horizon.
 *
 * Deliberately simple and explainable: Bench Boost wants the gameweek your bench
 * projects highest, Triple Captain the gameweek your best starter peaks. These
 * are projections over a short horizon, not a season plan — fixtures, injuries
 * and your own transfers will move them, so they are framed as a lean, not a
 * recommendation to burn a chip.
 */
export function suggestChips(input: ChipInput): ChipSuggestion[] {
  const { perGw, horizon, available } = input;
  if (perGw.length === 0 || horizon.length === 0) return [];
  const out: ChipSuggestion[] = [];

  if (available.includes("Bench Boost")) {
    let best = { gw: 0, value: -1 };
    for (const gw of horizon) {
      const total = perGw
        .filter((p) => !p.isStart)
        .reduce((sum, p) => sum + (p.gws.get(gw) ?? 0), 0);
      if (total > best.value) best = { gw, value: total };
    }
    if (best.gw) {
      out.push({
        chip: "Bench Boost",
        gw: best.gw,
        value: best.value,
        detail: `bench projects ${best.value.toFixed(1)} pts`,
      });
    }
  }

  if (available.includes("Triple Captain")) {
    let best = { gw: 0, value: -1 };
    for (const gw of horizon) {
      const top = Math.max(
        0,
        ...perGw.filter((p) => p.isStart).map((p) => p.gws.get(gw) ?? 0),
      );
      if (top > best.value) best = { gw, value: top };
    }
    if (best.gw) {
      out.push({
        chip: "Triple Captain",
        gw: best.gw,
        value: best.value,
        detail: `best starter projects ${best.value.toFixed(1)} pts (×3 = ${(best.value * 3).toFixed(1)})`,
      });
    }
  }

  if (available.includes("Free Hit")) {
    // Free Hit earns its keep when your squad has the fewest players playing.
    let worst = { gw: 0, value: Number.POSITIVE_INFINITY };
    for (const gw of horizon) {
      const playing = perGw.filter((p) => (p.gws.get(gw) ?? 0) > 0).length;
      if (playing < worst.value) worst = { gw, value: playing };
    }
    if (worst.gw && worst.value < perGw.length) {
      out.push({
        chip: "Free Hit",
        gw: worst.gw,
        value: worst.value,
        detail: `only ${worst.value} of your ${perGw.length} have a fixture`,
      });
    }
  }

  return out;
}


// --- Multi-transfer planning ----------------------------------------------

export interface PlanPlayer {
  element: number;
  name: string;
  position: Position;
  team: string;
  price: number;
  /** Projected xP per gameweek. */
  gws: Map<number, number>;
}

export interface PlannedMove {
  out: PlanPlayer;
  in: PlanPlayer;
  gain: number;      // horizon xP gained by this swap
  costChange: number; // £m spent (negative frees money)
}

export interface TransferPlan {
  moves: PlannedMove[];
  /** The squad after the moves, for showing the resulting side. */
  squad: PlanPlayer[];
  baselineXp: number;   // horizon xP of the squad as it stands
  plannedXp: number;    // horizon xP after the moves
  hits: number;         // points deducted for transfers beyond the free ones
  netGain: number;      // plannedXp - baselineXp - hits
  bankAfter: number;
}

const horizonXp = (p: PlanPlayer, horizon: number[]): number =>
  horizon.reduce((sum, gw) => sum + (p.gws.get(gw) ?? 0), 0);

/** Value a squad the way FPL scores it: best legal XI each gameweek, captain
 * doubled, bench worth nothing. Summing all fifteen (as this used to) inflates
 * every total and lets the planner "upgrade" a bench slot for a gain that can
 * never be realised. */
const valueSquad = (squad: PlanPlayer[], horizon: number[]): number =>
  squadHorizonXp(squad, horizon, (p, gw) => p.gws.get(gw) ?? 0);

/** Candidates considered per position each round. The full pool is ~600; a
 * player outside the top few dozen for their position over the horizon cannot
 * displace an XI slot, and evaluating every one against a full XI re-pick for
 * every squad member is what makes this interactive rather than sluggish. */
const POOL_PER_POSITION = 40;

/**
 * Greedy multi-transfer plan over a horizon.
 *
 * Each round scores every legal swap by how much it moves the WHOLE squad's
 * best-XI value — not by the two players' own xP — so a swap only counts when
 * it actually changes what you would field, and bench cover is valued at what
 * it is worth rather than at face value. The best swap is applied, then the
 * search repeats, so later moves see the squad the earlier ones produced.
 *
 * Hits are charged beyond the free allowance and subtracted, so the net figure
 * is the honest one: a plan gaining 3 xP for a -4 hit is shown as losing a point.
 */
export function planTransfers(args: {
  squad: PlanPlayer[];
  candidates: PlanPlayer[];
  horizon: number[];
  bank: number;
  maxTransfers: number;
  freeTransfers: number;
  hitCost: number;
}): TransferPlan {
  const { horizon, bank, maxTransfers, freeTransfers, hitCost } = args;
  const baselineXp = valueSquad(args.squad, horizon);

  let squad = [...args.squad];
  let money = bank;
  let value = baselineXp;
  const moves: PlannedMove[] = [];
  const owned = new Set(squad.map((p) => p.element));

  // Prune once: the strongest candidates per position over this horizon.
  const pool = new Map<Position, PlanPlayer[]>();
  for (const c of args.candidates) {
    const list = pool.get(c.position) ?? [];
    list.push(c);
    pool.set(c.position, list);
  }
  for (const [pos, list] of pool) {
    list.sort((a, b) => horizonXp(b, horizon) - horizonXp(a, horizon));
    pool.set(pos, list.slice(0, POOL_PER_POSITION));
  }

  for (let round = 0; round < maxTransfers; round += 1) {
    const clubCounts = new Map<string, number>();
    for (const p of squad) clubCounts.set(p.team, (clubCounts.get(p.team) ?? 0) + 1);

    let best: { out: PlanPlayer; in: PlanPlayer; gain: number; value: number } | null = null;
    for (let i = 0; i < squad.length; i += 1) {
      const out = squad[i]!;
      for (const cand of pool.get(out.position) ?? []) {
        if (owned.has(cand.element)) continue;
        if (cand.price > money + out.price) continue;
        const clubAfter =
          (clubCounts.get(cand.team) ?? 0) - (out.team === cand.team ? 1 : 0) + 1;
        if (clubAfter > 3) continue;
        const trial = squad.slice();
        trial[i] = cand;
        const trialValue = valueSquad(trial, horizon);
        const gain = trialValue - value;
        if (gain > (best?.gain ?? 0)) best = { out, in: cand, gain, value: trialValue };
      }
    }
    if (!best) break;

    money += best.out.price - best.in.price;
    squad = squad.map((p) => (p.element === best!.out.element ? best!.in : p));
    value = best.value;
    owned.delete(best.out.element);
    owned.add(best.in.element);
    moves.push({
      out: best.out,
      in: best.in,
      gain: Math.round(best.gain * 10) / 10,
      costChange: Math.round((best.in.price - best.out.price) * 10) / 10,
    });
  }

  const hits = Math.max(0, moves.length - freeTransfers) * hitCost;
  return {
    moves,
    squad,
    baselineXp: Math.round(baselineXp * 10) / 10,
    plannedXp: Math.round(value * 10) / 10,
    hits,
    netGain: Math.round((value - baselineXp - hits) * 10) / 10,
    bankAfter: Math.round(money * 10) / 10,
  };
}

/**
 * The best legal single upgrade for ONE squad slot, valued by its effect on the
 * XI — the same currency the planner uses.
 *
 * Without this the "weakest slots" panel ranks by raw xP while the planner ranks
 * by XI impact under budget and club limits, so the two can disagree about which
 * player to move. This makes the panel answer the question it implies: what
 * would replacing this player actually be worth?
 */
export function bestUpgradeFor(args: {
  squad: PlanPlayer[];
  candidates: PlanPlayer[];
  horizon: number[];
  bank: number;
  element: number;
}): { in: PlanPlayer; gain: number } | null {
  const { squad, horizon, bank, element } = args;
  const index = squad.findIndex((p) => p.element === element);
  if (index < 0) return null;
  const out = squad[index]!;
  const base = valueSquad(squad, horizon);
  const owned = new Set(squad.map((p) => p.element));
  const clubCounts = new Map<string, number>();
  for (const p of squad) clubCounts.set(p.team, (clubCounts.get(p.team) ?? 0) + 1);

  const pool = args.candidates
    .filter((c) => c.position === out.position && !owned.has(c.element) && c.price <= bank + out.price)
    .sort((a, b) => horizonXp(b, horizon) - horizonXp(a, horizon))
    .slice(0, POOL_PER_POSITION);

  let best: { in: PlanPlayer; gain: number } | null = null;
  for (const cand of pool) {
    const clubAfter = (clubCounts.get(cand.team) ?? 0) - (out.team === cand.team ? 1 : 0) + 1;
    if (clubAfter > 3) continue;
    const trial = squad.slice();
    trial[index] = cand;
    const gain = valueSquad(trial, horizon) - base;
    if (gain > (best?.gain ?? 0)) best = { in: cand, gain: Math.round(gain * 10) / 10 };
  }
  return best;
}

/** Per-gameweek breakdown of a squad: the XI total (captain doubled) each week,
 * so the planner can show WHERE the gain lands rather than one lump sum. */
export function perGwTotals(squad: PlanPlayer[], horizon: number[]): { gw: number; xp: number }[] {
  return horizon.map((gw) => ({
    gw,
    xp:
      Math.round(
        pickBestXi(squad, (p: PlanPlayer) => p.gws.get(gw) ?? 0, { captain: true }).total * 10,
      ) / 10,
  }));
}
