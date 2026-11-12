import { describe, expect, it } from "vitest";

import type { TickerCell } from "../../lib/types";
import { fdrClasses, fdrValue, gwDifficulty, sortTeams, windowScore } from "./fdr";

const cell = (over: Partial<TickerCell>): TickerCell => ({
  opp_id: 1,
  opp_short: "ARS",
  home: true,
  official_fdr: 3,
  attack_fdr: 2,
  defence_fdr: 4,
  kickoff: null,
  finished: false,
  ...over,
});

describe("fdrValue", () => {
  it("selects the field for the chosen mode", () => {
    const c = cell({});
    expect(fdrValue(c, "official")).toBe(3);
    expect(fdrValue(c, "attack")).toBe(2);
    expect(fdrValue(c, "defence")).toBe(4);
  });
});

describe("fdrClasses", () => {
  it("maps 1..5 to ramp classes and null to neutral", () => {
    expect(fdrClasses(1).bg).toBe("bg-fdr-1");
    expect(fdrClasses(5).bg).toBe("bg-fdr-5");
    expect(fdrClasses(null).bg).toBe("bg-surface-2");
  });
});

describe("windowScore", () => {
  it("sums FDR across gameweeks including double gameweeks", () => {
    const cells = {
      "2": [cell({ official_fdr: 2 })],
      "3": [cell({ official_fdr: 4 }), cell({ official_fdr: 5 })], // DGW: two fixtures
    };
    const { sum, count } = windowScore(cells, [2, 3], "official");
    expect(sum).toBe(11);
    expect(count).toBe(3);
  });

  it("skips blank gameweeks (no cells)", () => {
    const cells = { "2": [], "3": [cell({ official_fdr: 3 })] };
    const { sum, count } = windowScore(cells, [2, 3], "official");
    expect(sum).toBe(3);
    expect(count).toBe(1);
  });
});

// --- sorting -----------------------------------------------------------------

const team = (short_name: string, byGw: Record<number, number[]>) => ({
  short_name,
  cells: Object.fromEntries(
    Object.entries(byGw).map(([gw, fdrs]) => [gw, fdrs.map((f) => cell({ official_fdr: f }))]),
  ),
});
const GWS = [10, 11];
const names = (rows: { short_name: string }[]) => rows.map((r) => r.short_name);

describe("sortTeams", () => {
  const teams = [
    team("BBB", { 10: [4], 11: [4] }), // avg 4
    team("AAA", { 10: [2], 11: [3] }), // avg 2.5
    team("CCC", { 10: [1], 11: [5] }), // avg 3
  ];

  it("ranks easiest run first by default and flips to hardest first", () => {
    expect(names(sortTeams(teams, GWS, "official", { key: "avg", dir: "asc" }))).toEqual(["AAA", "CCC", "BBB"]);
    expect(names(sortTeams(teams, GWS, "official", { key: "avg", dir: "desc" }))).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("sorts by a single gameweek's difficulty", () => {
    expect(names(sortTeams(teams, GWS, "official", { key: 11, dir: "asc" }))).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("sorts by team name", () => {
    expect(names(sortTeams(teams, GWS, "official", { key: "team", dir: "desc" }))).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("sinks a blank gameweek to the bottom in BOTH directions", () => {
    const withBlank = [...teams, team("ZZZ", { 11: [1] })]; // blank in GW10
    for (const dir of ["asc", "desc"] as const) {
      const out = names(sortTeams(withBlank, GWS, "official", { key: 10, dir }));
      expect(out[out.length - 1]).toBe("ZZZ");
    }
  });

  it("breaks ties by team name so the order is stable", () => {
    const tied = [team("YYY", { 10: [3], 11: [3] }), team("XXX", { 10: [3], 11: [3] })];
    expect(names(sortTeams(tied, GWS, "official", { key: "avg", dir: "desc" }))).toEqual(["XXX", "YYY"]);
  });

  it("exposes the window average it sorted on", () => {
    const out = sortTeams(teams, GWS, "official", { key: "avg", dir: "asc" });
    expect(out[0]!.avg).toBeCloseTo(2.5);
  });
});

describe("gwDifficulty", () => {
  it("averages a double gameweek and returns null for a blank", () => {
    const t = team("DGW", { 10: [2, 4] });
    expect(gwDifficulty(t.cells, 10, "official")).toBe(3);
    expect(gwDifficulty(t.cells, 11, "official")).toBeNull();
  });
});
