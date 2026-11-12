import { useCallback, useEffect, useMemo, useState } from "react";

import type { Position } from "../../lib/types";
import { type Formation, FORMATIONS, formationLabel, pickBestXi } from "./squad";

/**
 * Preview mode: a scratch copy of the squad the user can rearrange freely —
 * change formation, swap the bench in, make provisional transfers — without any
 * of it being saved. Nothing here touches the FPL account; the public API is
 * read-only and we never authenticate. It is a what-if sandbox, and the reset
 * always returns to the real squad.
 */

export interface PreviewPlayer {
  element: number;
  name: string;
  position: Position;
  team: string;
  price: number;
  /** Projected xP per gameweek. */
  gws: Map<number, number>;
}

export interface PreviewState {
  squad: PreviewPlayer[];
  startIds: Set<number>;
  captainId: number | null;
  /** Money available for provisional transfers, in £m. */
  bank: number;
  dirty: boolean;
}

const countByPos = (players: PreviewPlayer[]): Record<Position, number> => {
  const out = { GKP: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
  for (const p of players) out[p.position] = (out[p.position] ?? 0) + 1;
  return out;
};

/** A starting eleven is legal at 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD. */
export function isLegalXi(xi: PreviewPlayer[]): boolean {
  if (xi.length !== 11) return false;
  const c = countByPos(xi);
  return c.GKP === 1 && c.DEF >= 3 && c.DEF <= 5 && c.MID >= 2 && c.MID <= 5 && c.FWD >= 1 && c.FWD <= 3;
}

export function usePreview(args: {
  squad: PreviewPlayer[];
  startIds: number[];
  captainId: number | null;
  bank: number;
  /** Gameweek the projections are being read for, used when auto-picking. */
  gw: number | null;
}) {
  const { squad, startIds, captainId, bank, gw } = args;

  const [state, setState] = useState<PreviewState | null>(null);

  // (Re)seed whenever the real squad arrives or changes identity. Deliberately
  // keyed on the element ids, not the array reference, so stepping through
  // gameweeks keeps the user's edits instead of wiping them each time.
  const key = squad.map((p) => p.element).join(",");
  useEffect(() => {
    if (squad.length === 0) return;
    setState({
      squad: [...squad],
      startIds: new Set(startIds),
      captainId,
      bank,
      dirty: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reset = useCallback(() => {
    setState({ squad: [...squad], startIds: new Set(startIds), captainId, bank, dirty: false });
  }, [squad, startIds, captainId, bank]);

  /** Swap two players between XI and bench (or reject an illegal shape). */
  const swap = useCallback((a: number, b: number) => {
    setState((s) => {
      if (!s) return s;
      const inA = s.startIds.has(a);
      const inB = s.startIds.has(b);
      if (inA === inB) return s; // both starting or both benched: nothing to do
      const next = new Set(s.startIds);
      if (inA) { next.delete(a); next.add(b); } else { next.delete(b); next.add(a); }
      const xi = s.squad.filter((p) => next.has(p.element));
      if (!isLegalXi(xi)) return s;
      // A captain who has just been benched loses the armband.
      const captain = s.captainId !== null && next.has(s.captainId) ? s.captainId : null;
      return { ...s, startIds: next, captainId: captain, dirty: true };
    });
  }, []);

  /** Re-pick the best XI for a given shape, by the selected gameweek's xP. */
  const setFormation = useCallback((f: Formation) => {
    setState((s) => {
      if (!s) return s;
      const xp = (p: PreviewPlayer) => (gw === null ? 0 : (p.gws.get(gw) ?? 0));
      const take = (pos: Position, n: number) =>
        s.squad.filter((p) => p.position === pos).sort((a, b) => xp(b) - xp(a)).slice(0, n);
      const xi = [...take("GKP", 1), ...take("DEF", f.def), ...take("MID", f.mid), ...take("FWD", f.fwd)];
      if (!isLegalXi(xi)) return s;
      const next = new Set(xi.map((p) => p.element));
      const captain = s.captainId !== null && next.has(s.captainId) ? s.captainId : null;
      return { ...s, startIds: next, captainId: captain, dirty: true };
    });
  }, [gw]);

  /** Provisional transfer: swap one owned player for one who is not owned. */
  const transfer = useCallback((outId: number, incoming: PreviewPlayer) => {
    setState((s) => {
      if (!s) return s;
      const out = s.squad.find((p) => p.element === outId);
      if (!out || out.position !== incoming.position) return s;
      if (s.squad.some((p) => p.element === incoming.element)) return s;
      const money = s.bank + out.price - incoming.price;
      if (money < 0) return s;
      const clubs = s.squad.filter(
        (p) => p.element !== outId && p.team === incoming.team,
      ).length;
      if (clubs >= 3) return s;
      const next = new Set(s.startIds);
      if (next.has(outId)) { next.delete(outId); next.add(incoming.element); }
      return {
        ...s,
        squad: s.squad.map((p) => (p.element === outId ? incoming : p)),
        startIds: next,
        captainId: s.captainId === outId ? null : s.captainId,
        bank: Math.round(money * 10) / 10,
        dirty: true,
      };
    });
  }, []);

  const setCaptain = useCallback((id: number) => {
    setState((s) => (s && s.startIds.has(id) ? { ...s, captainId: id, dirty: true } : s));
  }, []);

  /** Auto-pick the best legal XI and captain for the selected gameweek. */
  const autoPick = useCallback(() => {
    setState((s) => {
      if (!s || gw === null) return s;
      const sel = pickBestXi(s.squad, (p) => p.gws.get(gw) ?? 0);
      if (sel.xi.length !== 11) return s;
      return {
        ...s,
        startIds: new Set(sel.xi.map((p) => p.element)),
        captainId: sel.captain?.element ?? null,
        dirty: true,
      };
    });
  }, [gw]);

  const derived = useMemo(() => {
    if (!state || gw === null) {
      return { xi: [], bench: [], formation: null as Formation | null, total: 0 };
    }
    const xi = state.squad.filter((p) => state.startIds.has(p.element));
    const bench = state.squad.filter((p) => !state.startIds.has(p.element));
    const c = countByPos(xi);
    const formation =
      FORMATIONS.find((f) => f.def === c.DEF && f.mid === c.MID && f.fwd === c.FWD) ?? null;
    const xpOf = (p: PreviewPlayer) => p.gws.get(gw) ?? 0;
    const cap = state.captainId !== null ? xi.find((p) => p.element === state.captainId) : undefined;
    const total =
      xi.reduce((sum, p) => sum + xpOf(p), 0) + (cap ? xpOf(cap) : 0);
    return { xi, bench, formation, total: Math.round(total * 10) / 10 };
  }, [state, gw]);

  return { state, ...derived, formationLabel, swap, setFormation, transfer, setCaptain, autoPick, reset };
}
