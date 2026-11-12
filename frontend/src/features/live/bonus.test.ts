import { describe, expect, it } from "vitest";

import type { LiveElement } from "../../lib/fpl";
import { computeLiveBonus, fixtureBonus } from "./bonus";

const rows = (...bps: number[]) => bps.map((b, i) => ({ element: i + 1, bps: b }));

describe("fixtureBonus (FPL tie rules)", () => {
  it("awards 3/2/1 with no ties", () => {
    const m = fixtureBonus(rows(40, 30, 20, 10));
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([3, 2, 1, 0]);
  });

  it("two tied for 1st → 3,3,1 (the '2' position is consumed)", () => {
    const m = fixtureBonus(rows(40, 40, 30, 20));
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([3, 3, 1, 0]);
  });

  it("two tied for 2nd → 3,2,2", () => {
    const m = fixtureBonus(rows(40, 30, 30, 20));
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([3, 2, 2, 0]);
  });

  it("two tied for 3rd → 3,2,1,1", () => {
    const m = fixtureBonus(rows(40, 30, 20, 20));
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([3, 2, 1, 1]);
  });

  it("three tied for 1st → 3,3,3,0", () => {
    const m = fixtureBonus(rows(40, 40, 40, 10));
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([3, 3, 3, 0]);
  });
});

function liveEl(id: number, bps: number, bonus: number, fixture: number): LiveElement {
  return {
    id,
    stats: { minutes: 90, bps, bonus, total_points: 2 + bonus, goals_scored: 0, assists: 0 },
    explain: [{ fixture }],
  };
}

describe("computeLiveBonus", () => {
  it("computes provisional bonus + flag when official is not yet added", () => {
    const els = [liveEl(1, 40, 0, 100), liveEl(2, 30, 0, 100), liveEl(3, 20, 0, 100)];
    const r = computeLiveBonus(els);
    expect(r.get(1)).toEqual({ bonus: 3, provisional: true });
    expect(r.get(2)).toEqual({ bonus: 2, provisional: true });
    expect(r.get(3)!.provisional).toBe(true);
  });

  it("uses official bonus verbatim (not provisional) once it is added", () => {
    const els = [liveEl(1, 40, 3, 100), liveEl(2, 30, 2, 100), liveEl(3, 20, 1, 100)];
    const r = computeLiveBonus(els);
    expect(r.get(1)).toEqual({ bonus: 3, provisional: false });
    expect(r.get(3)).toEqual({ bonus: 1, provisional: false });
  });
});
