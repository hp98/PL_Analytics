import { describe, expect, it } from "vitest";

import { fmtCompact } from "./format";

describe("fmtCompact", () => {
  it("compacts large counts so they fit a narrow column", () => {
    expect(fmtCompact(3_167_457)).toMatch(/^3\.17\s?M$/);
    expect(fmtCompact(1_026_526)).toMatch(/^1\.03\s?M$/);
  });

  it("keeps small counts exact", () => {
    expect(fmtCompact(42)).toBe("42");
    expect(fmtCompact(9_999)).toBe((9_999).toLocaleString());
  });

  it("shows a dash for missing values rather than zero", () => {
    expect(fmtCompact(null)).toBe("—");
    expect(fmtCompact(undefined)).toBe("—");
  });
});
