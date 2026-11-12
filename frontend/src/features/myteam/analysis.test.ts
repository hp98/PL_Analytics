import { describe, expect, it } from "vitest";

import type { OptimalSquad, PlayerLive, Projections } from "../../lib/types";
import {
  buildCandidates,
  type Candidate,
  computeTeamRating,
  type SquadMember,
  suggestTransfers,
} from "./analysis";

function optimalOf(xiXp: number, cost: number): OptimalSquad {
  return { horizon: [1, 2, 3, 4, 5], xi_xp: xiXp, cost, bank: 100 - cost, status: "Optimal", picks: [] };
}

function member(over: Partial<SquadMember>): SquadMember {
  return {
    element: 1, position: "MID", team: "ARS", price: 6, next5: 20,
    isCaptain: false, isStart: true, ...over,
  };
}

describe("computeTeamRating", () => {
  it("rates a strong squad above a weak one, with explainable sub-scores", () => {
    const opt = optimalOf(240, 66);
    const strong = Array.from({ length: 11 }, (_, i) => member({ element: i + 1, next5: 20 }));
    const weak = Array.from({ length: 11 }, (_, i) => member({ element: i + 1, next5: 8 }));
    const rs = computeTeamRating(strong, opt);
    const rw = computeTeamRating(weak, opt);
    expect(rs.overall).toBeGreaterThan(rw.overall);
    expect(rs.subs).toHaveLength(3);
    expect(rs.subs[0]!.score).toBeGreaterThan(rw.subs[0]!.score);
    expect(rs.subs[0]!.detail).toMatch(/next 5 GWs/);
  });

  it("clamps sub-scores to 0-100", () => {
    const r = computeTeamRating([member({ next5: 500 })], optimalOf(10, 66));
    expect(r.subs.every((s) => s.score >= 0 && s.score <= 100)).toBe(true);
  });
});

describe("suggestTransfers", () => {
  const squad: SquadMember[] = [
    member({ element: 1, position: "FWD", team: "ARS", price: 7, next5: 10 }),
    member({ element: 2, position: "MID", team: "LIV", price: 6, next5: 25 }),
  ];
  const candidates: Candidate[] = [
    { element: 1, web_name: "OldFwd", position: "FWD", team: "ARS", price: 7, next5: 10 },
    { element: 2, web_name: "GoodMid", position: "MID", team: "LIV", price: 6, next5: 25 },
    { element: 3, web_name: "BetterFwd", position: "FWD", team: "CHE", price: 7.5, next5: 22 },
    { element: 4, web_name: "TooDear", position: "FWD", team: "TOT", price: 20, next5: 30 },
  ];

  it("suggests an affordable, higher-xP same-position upgrade", () => {
    const s = suggestTransfers(squad, candidates, /* bank */ 1.0);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.inName).toBe("BetterFwd");
    expect(s[0]!.delta).toBeCloseTo(12);
  });

  it("does not suggest an unaffordable target", () => {
    const s = suggestTransfers(squad, candidates, /* bank */ 0.1);
    expect(s.every((x) => x.inName !== "TooDear")).toBe(true);
  });

  it("respects the max-3-per-club rule", () => {
    // 3 strong CHE defenders (not worth moving) + 1 weak ARS defender; the only
    // improving target is a 4th CHE defender, which is illegal for the ARS slot.
    const packed: SquadMember[] = [
      member({ element: 10, position: "DEF", team: "CHE", next5: 30 }),
      member({ element: 11, position: "DEF", team: "CHE", next5: 30 }),
      member({ element: 12, position: "DEF", team: "CHE", next5: 30 }),
      member({ element: 13, position: "DEF", team: "ARS", next5: 2 }),
    ];
    const cands: Candidate[] = [
      { element: 99, web_name: "FourthChelsea", position: "DEF", team: "CHE", price: 5, next5: 30 },
    ];
    expect(suggestTransfers(packed, cands, 50)).toHaveLength(0);
  });
});

describe("buildCandidates", () => {
  it("drops unavailable players and attaches next-5 xP", () => {
    const players: PlayerLive[] = [
      { element: 1, web_name: "A", team_short: "ARS", position: "MID", price_m: 6, ownership_pct: 10, status: "a" },
      { element: 2, web_name: "Injured", team_short: "LIV", position: "FWD", price_m: 9, ownership_pct: 5, status: "i" },
    ];
    const projections: Projections = {
      horizon: [1],
      players: { "1": { web_name: "A", position: "MID", next_gw: null, next5_xp: 18, per_gw: [] } },
    };
    const c = buildCandidates(players, projections);
    expect(c).toHaveLength(1);
    expect(c[0]!.next5).toBe(18);
  });
});

// --- transfer planning -----------------------------------------------------

import { planTransfers, type PlanPlayer } from "./analysis";
import { FORMATIONS, formationLabel, pickBestXi } from "./squad";

const HORIZON = [3, 4, 5];

/** One player with a flat per-gameweek projection. */
const pp = (
  element: number,
  name: string,
  position: PlanPlayer["position"],
  perGw: number,
  over: Partial<PlanPlayer> = {},
): PlanPlayer => ({
  element,
  name,
  position,
  team: `T${element}`,
  price: 5,
  gws: new Map(HORIZON.map((gw) => [gw, perGw])),
  ...over,
});

/** A legal 15: 2 GKP / 5 DEF / 5 MID / 3 FWD. Bench slots are the low scorers,
 * so anything that only improves the bench must not register as a gain. */
function legalSquad(): PlanPlayer[] {
  const out: PlanPlayer[] = [];
  let id = 1;
  out.push(pp(id++, "GK1", "GKP", 4), pp(id++, "GK2", "GKP", 1));
  for (const xp of [5, 4.5, 4, 3.5, 3]) out.push(pp(id++, `D${id}`, "DEF", xp));
  for (const xp of [6, 5.5, 5, 4.5, 1]) out.push(pp(id++, `M${id}`, "MID", xp));
  for (const xp of [7, 6, 1]) out.push(pp(id++, `F${id}`, "FWD", xp));
  return out;
}

describe("pickBestXi", () => {
  it("enumerates exactly the eight legal FPL shapes", () => {
    expect(FORMATIONS).toHaveLength(8);
    expect(FORMATIONS.every((f) => f.def + f.mid + f.fwd === 10)).toBe(true);
    expect(FORMATIONS.map(formationLabel)).toContain("3-4-3");
    expect(FORMATIONS.map(formationLabel)).toContain("5-4-1");
  });

  it("fields eleven with exactly one keeper, and benches the other four", () => {
    const sel = pickBestXi(legalSquad(), (p) => p.gws.get(3) ?? 0);
    expect(sel.xi).toHaveLength(11);
    expect(sel.bench).toHaveLength(4);
    expect(sel.xi.filter((p) => p.position === "GKP")).toHaveLength(1);
  });

  it("picks the highest-scoring legal shape, not merely the top eleven", () => {
    const sel = pickBestXi(legalSquad(), (p) => p.gws.get(3) ?? 0);
    // Top 11 by raw xP would field only two forwards' worth of defenders;
    // 4-4-2 scores best here.
    expect(formationLabel(sel.formation!)).toBe("4-4-2");
  });

  it("doubles the captain only when asked", () => {
    const squad = legalSquad();
    const plain = pickBestXi(squad, (p) => p.gws.get(3) ?? 0);
    const capped = pickBestXi(squad, (p) => p.gws.get(3) ?? 0, { captain: true });
    expect(capped.captain?.name).toBe("F14"); // the 7.0 forward
    expect(capped.total).toBeCloseTo(plain.total + 7);
  });
});

describe("planTransfers", () => {
  const base = {
    horizon: HORIZON,
    bank: 5,
    maxTransfers: 1,
    freeTransfers: 1,
    hitCost: 4,
  };

  it("values the squad by its XI, not all fifteen", () => {
    const plan = planTransfers({ ...base, squad: legalSquad(), candidates: [], maxTransfers: 0 });
    // Sum of all 15 over 3 GWs would be 3 x 61 = 183; the XI (captain doubled)
    // is worth 3 x 62 = 186 -- and critically excludes the four bench players.
    const allFifteen = 3 * legalSquad().reduce((s, p) => s + (p.gws.get(3) ?? 0), 0);
    expect(plan.baselineXp).not.toBeCloseTo(allFifteen);
    expect(plan.baselineXp).toBeCloseTo(186);
  });

  it("takes an upgrade that improves the XI", () => {
    const plan = planTransfers({
      ...base,
      squad: legalSquad(),
      candidates: [pp(99, "StarMid", "MID", 9)],
    });
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]!.in.name).toBe("StarMid");
    expect(plan.netGain).toBeGreaterThan(0);
  });

  it("REGRESSION: refuses an upgrade that only improves the bench", () => {
    // Better than the backup keeper (1.0) but worse than the starter (4.0), so
    // the XI is unchanged and the gain is zero. The old all-fifteen valuation
    // scored this as +6 and would have burned a transfer on it.
    const plan = planTransfers({
      ...base,
      squad: legalSquad(),
      candidates: [pp(99, "BackupGK", "GKP", 3)],
    });
    expect(plan.moves).toHaveLength(0);
    expect(plan.netGain).toBe(0);
  });

  it("charges a hit beyond the free allowance and nets it off", () => {
    const plan = planTransfers({
      ...base,
      squad: legalSquad(),
      candidates: [pp(98, "StarMid", "MID", 9), pp(99, "StarFwd", "FWD", 9)],
      maxTransfers: 2,
      freeTransfers: 1,
    });
    expect(plan.moves).toHaveLength(2);
    expect(plan.hits).toBe(4);
    expect(plan.netGain).toBeCloseTo(plan.plannedXp - plan.baselineXp - 4);
  });

  it("declines a second transfer that would not pay for its hit", () => {
    const plan = planTransfers({
      ...base,
      squad: legalSquad(),
      // One real upgrade; the second only nudges a bench slot.
      candidates: [pp(98, "StarMid", "MID", 9), pp(99, "MehGK", "GKP", 2)],
      maxTransfers: 2,
      freeTransfers: 1,
    });
    expect(plan.moves).toHaveLength(1);
    expect(plan.hits).toBe(0);
  });

  it("never exceeds the budget", () => {
    const plan = planTransfers({
      ...base,
      squad: legalSquad(),
      candidates: [pp(99, "TooDear", "MID", 99, { price: 50 })],
      bank: 0.5,
    });
    expect(plan.moves).toHaveLength(0);
    expect(plan.bankAfter).toBeCloseTo(0.5);
  });

  it("respects the max-3-per-club rule", () => {
    const squad = legalSquad();
    // Three midfielders already at CHE, one of them the weakest starter.
    squad[7] = pp(8, "C1", "MID", 6, { team: "CHE" });
    squad[8] = pp(9, "C2", "MID", 5.5, { team: "CHE" });
    squad[9] = pp(10, "C3", "MID", 5, { team: "CHE" });
    const plan = planTransfers({
      ...base,
      squad,
      // A 4th CHE player would break the limit for any non-CHE slot; the only
      // legal landing spot is swapping out one of the three CHE mids.
      candidates: [pp(99, "C4", "MID", 9, { team: "CHE" })],
      bank: 50,
    });
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]!.out.team).toBe("CHE");
  });
});
