import type { Position } from "./types";

export function fmtNum(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Math.round(v).toLocaleString();
}

const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });

/** Large counts for a narrow column: 3,167,457 -> "3.17M", 245,310 -> "245.31K".
 * Small values stay exact. Pair with a title carrying the full figure. */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Math.abs(v) < 10_000 ? Math.round(v).toLocaleString() : COMPACT.format(v);
}

export function fmtPrice(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  return `£${m.toFixed(1)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const POSITION_ORDER: Position[] = ["GKP", "DEF", "MID", "FWD", "MNG"];

export function positionColor(pos: Position): string {
  // Theme-aware: one CSS variable per position, used at 20% for the chip
  // background and full strength for the label, so contrast holds in light,
  // dark and football themes alike.
  switch (pos) {
    case "GKP":
      return "bg-pos-gkp/20 text-pos-gkp";
    case "DEF":
      return "bg-pos-def/20 text-pos-def";
    case "MID":
      return "bg-pos-mid/20 text-pos-mid";
    case "FWD":
      return "bg-pos-fwd/20 text-pos-fwd";
    default:
      return "bg-surface-3 text-ink-muted";
  }
}
