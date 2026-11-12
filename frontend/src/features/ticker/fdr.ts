import type { FdrMode, TickerCell } from "../../lib/types";

// Colour-blind-safe FDR ramp (blue -> teal -> amber -> orange -> red). Always
// paired with the numeric value in the cell — never colour as the only signal.
// The ramp colours are identical in every theme, so the label colour must be
// constant too: `text-surface-0` would flip to near-white in the light theme and
// wash out on the amber/orange cells.
const RAMP: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-fdr-1", text: "text-white" },
  2: { bg: "bg-fdr-2", text: "text-fdr-ink" },
  3: { bg: "bg-fdr-3", text: "text-fdr-ink" },
  4: { bg: "bg-fdr-4", text: "text-fdr-ink" },
  5: { bg: "bg-fdr-5", text: "text-white" },
};

export function fdrValue(cell: TickerCell, mode: FdrMode): number | null {
  if (mode === "attack") return cell.attack_fdr;
  if (mode === "defence") return cell.defence_fdr;
  return cell.official_fdr;
}

export function fdrClasses(value: number | null): { bg: string; text: string } {
  if (value === null || !RAMP[value]) return { bg: "bg-surface-2", text: "text-ink-faint" };
  return RAMP[value];
}

/** Sum of a team's FDR over the visible gameweeks for the chosen mode. */
export function windowScore(
  cells: Record<string, TickerCell[]>,
  gws: number[],
  mode: FdrMode,
): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const gw of gws) {
    for (const cell of cells[String(gw)] ?? []) {
      const v = fdrValue(cell, mode);
      if (v !== null) {
        sum += v;
        count += 1;
      }
    }
  }
  return { sum, count };
}

// --- sorting -----------------------------------------------------------------

/** Sort by team name, by the window average, or by one gameweek's difficulty. */
export type TickerSortKey = "team" | "avg" | number;
export interface TickerSort {
  key: TickerSortKey;
  dir: "asc" | "desc";
}

/** Difficulty for a single gameweek; a double gameweek averages its fixtures,
 * and a blank gameweek has no difficulty at all (null). */
export function gwDifficulty(
  cells: Record<string, TickerCell[]>,
  gw: number,
  mode: FdrMode,
): number | null {
  const vals = (cells[String(gw)] ?? [])
    .map((c) => fdrValue(c, mode))
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Order ticker rows. Teams with no value for the chosen key (a blank gameweek,
 * or no fixtures in the window) always sink to the bottom whichever direction is
 * picked -- "hardest first" should not lead with a team that isn't playing.
 * Ties fall back to team name so the order is stable rather than arbitrary.
 */
export function sortTeams<T extends { short_name: string; cells: Record<string, TickerCell[]> }>(
  teams: T[],
  gws: number[],
  mode: FdrMode,
  sort: TickerSort,
): (T & { avg: number | null })[] {
  const flip = sort.dir === "asc" ? 1 : -1;
  const rows = teams.map((t) => {
    const { sum, count } = windowScore(t.cells, gws, mode);
    return { ...t, avg: count ? sum / count : null };
  });
  const keyOf = (r: (typeof rows)[number]): number | null =>
    sort.key === "avg" ? r.avg : typeof sort.key === "number" ? gwDifficulty(r.cells, sort.key, mode) : null;

  return rows.sort((a, b) => {
    if (sort.key === "team") return flip * a.short_name.localeCompare(b.short_name);
    const va = keyOf(a);
    const vb = keyOf(b);
    if (va === null && vb === null) return a.short_name.localeCompare(b.short_name);
    if (va === null) return 1;
    if (vb === null) return -1;
    return flip * (va - vb) || a.short_name.localeCompare(b.short_name);
  });
}
