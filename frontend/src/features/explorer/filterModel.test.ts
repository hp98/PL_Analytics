import { describe, expect, it } from "vitest";

import { sqlString } from "../../lib/sql";
import { buildWhere, defaultFilters } from "./filterModel";

describe("buildWhere", () => {
  it("defaults to season equality and the four squad positions (no MNG)", () => {
    const w = buildWhere(defaultFilters("2024-25"));
    expect(w).toContain("season = '2024-25'");
    expect(w).toContain("position in ('GKP', 'DEF', 'MID', 'FWD')");
    expect(w).not.toContain("MNG");
  });

  it("adds a case-insensitive name search", () => {
    const f = { ...defaultFilters("2024-25"), search: "Salah" };
    expect(buildWhere(f)).toContain("lower(name) like '%salah%'");
  });

  it("applies price, minutes and a numeric stat filter", () => {
    const f = {
      ...defaultFilters("2024-25"),
      priceMin: 5,
      priceMax: 9,
      minMinutes: 900,
      statColumn: "season_xgi",
      statOp: ">=" as const,
      statValue: 5,
    };
    const w = buildWhere(f);
    expect(w).toContain("price_m >= 5");
    expect(w).toContain("price_m <= 9");
    expect(w).toContain("season_minutes >= 900");
    expect(w).toContain("season_xgi >= 5");
  });

  it("honours an explicit position selection", () => {
    const f = { ...defaultFilters("2024-25"), positions: ["MID" as const] };
    expect(buildWhere(f)).toContain("position in ('MID')");
  });

  it("ignores a stat filter with no value", () => {
    const f = { ...defaultFilters("2024-25"), statColumn: "season_xg", statValue: null };
    expect(buildWhere(f)).not.toContain("season_xg");
  });
});

describe("sqlString", () => {
  it("escapes single quotes to prevent injection", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });
});
