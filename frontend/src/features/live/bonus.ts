// Provisional bonus from live BPS. Verified against official GW bonus (0/610
// mismatches on a completed gameweek). The FPL rule is group-STARTING-position,
// not distinct value: e.g. two tied for 1st get 3 & 3, then the next gets 1 (the
// "2" position is consumed), NOT 2.

import type { LiveElement } from "../../lib/fpl";

const BONUS_BY_POSITION: Record<number, number> = { 1: 3, 2: 2, 3: 1 };

/** Bonus per element for one fixture, given (element, bps) rows. */
export function fixtureBonus(rows: { element: number; bps: number }[]): Map<number, number> {
  const sorted = [...rows].sort((a, b) => b.bps - a.bps);
  const out = new Map<number, number>();
  let pos = 1;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.bps === sorted[i]!.bps) j += 1;
    const bonus = BONUS_BY_POSITION[pos] ?? 0;
    for (let k = i; k < j; k += 1) out.set(sorted[k]!.element, bonus);
    pos += j - i; // ties consume their positions
    i = j;
  }
  return out;
}

export interface BonusInfo {
  bonus: number;
  provisional: boolean;
}

/** Per-element bonus across all fixtures. Official bonus (already added, present
 * in stats.bonus) is used verbatim and counted once; fixtures whose bonus is not
 * yet added contribute a provisional value, flagged as such. DGW-safe. */
export function computeLiveBonus(elements: LiveElement[]): Map<number, BonusInfo> {
  const rowsByFixture = new Map<number, { element: number; bps: number }[]>();
  const officialInFixture = new Map<number, number>();
  for (const el of elements) {
    for (const ex of el.explain) {
      const arr = rowsByFixture.get(ex.fixture) ?? [];
      arr.push({ element: el.id, bps: el.stats.bps });
      rowsByFixture.set(ex.fixture, arr);
      officialInFixture.set(ex.fixture, (officialInFixture.get(ex.fixture) ?? 0) + el.stats.bonus);
    }
  }

  // Provisional bonus map per fixture (empty once the official bonus is added).
  const provByFixture = new Map<number, Map<number, number>>();
  for (const [fixture, rows] of rowsByFixture) {
    const added = (officialInFixture.get(fixture) ?? 0) > 0;
    provByFixture.set(fixture, added ? new Map() : fixtureBonus(rows));
  }

  const result = new Map<number, BonusInfo>();
  for (const el of elements) {
    let provisionalAdd = 0;
    let anyProvisional = false;
    for (const ex of el.explain) {
      const add = provByFixture.get(ex.fixture)?.get(el.id) ?? 0;
      provisionalAdd += add;
      if (add > 0) anyProvisional = true;
    }
    result.set(el.id, {
      bonus: el.stats.bonus + provisionalAdd, // official (once) + provisional
      provisional: anyProvisional,
    });
  }
  return result;
}
