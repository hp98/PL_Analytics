import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { TeamBadge } from "../components/TeamBadge";
import { fetchPlayersLive, fetchProjections } from "../lib/api";
import { fmtInt, fmtPrice, positionColor } from "../lib/format";
import type { Position } from "../lib/types";
import { useLive } from "../features/live/useLive";
import { Pitch } from "../features/myteam/Pitch";
import { PreviewPitch } from "../features/myteam/PreviewPitch";
import { FORMATIONS, formationLabel } from "../features/myteam/squad";
import { type PreviewPlayer, usePreview } from "../features/myteam/usePreview";
import { useMyTeam } from "../features/myteam/useMyTeam";
import { useUiStore } from "../store/useUiStore";

export function MyTeamRoute() {
  const savedId = useUiStore((s) => s.entryId);
  const setEntryId = useUiStore((s) => s.setEntryId);
  const [input, setInput] = useState(savedId ?? "");
  // null = the gameweek in play; otherwise a future one.
  const [futureGw, setFutureGw] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const entryId = savedId && /^\d+$/.test(savedId) ? Number(savedId) : null;
  const { view, isLoading, error, currentGw } = useMyTeam(entryId);
  const live = useLive(entryId);
  const liveByElement = new Map((live.view?.players ?? []).map((p) => [p.element, p]));

  const { data: projections } = useQuery({ queryKey: ["projections"], queryFn: fetchProjections });
  const { data: playersLive } = useQuery({ queryKey: ["players-live"], queryFn: fetchPlayersLive });

  // Every gameweek the user can step to: the one in play, then the projected horizon.
  const gwList = useMemo(
    () => (currentGw !== null ? [currentGw, ...(view?.horizon ?? [])] : (view?.horizon ?? [])),
    [currentGw, view],
  );
  const shownGw = futureGw ?? currentGw;
  const gwIndex = shownGw === null ? -1 : gwList.indexOf(shownGw);
  const stepGw = (delta: number) => {
    const next = gwList[gwIndex + delta];
    if (next === undefined) return;
    setFutureGw(next === currentGw ? null : next);
  };

  // Scratch squad for preview mode.
  const squad: PreviewPlayer[] = useMemo(() => {
    if (!view) return [];
    return [...view.rows.flat(), ...view.bench].map((e) => ({
      element: e.pick.element,
      name: e.el?.web_name ?? `#${e.pick.element}`,
      position: e.position as Position,
      team: e.teamShort,
      price: e.el ? e.el.now_cost / 10 : 0,
      gws: view.perGw.get(e.pick.element) ?? new Map(),
    }));
  }, [view]);

  const startIds = useMemo(
    () => (view ? view.rows.flat().map((e) => e.pick.element) : []),
    [view],
  );
  const realCaptain = useMemo(
    () => view?.rows.flat().find((e) => e.pick.is_captain)?.pick.element ?? null,
    [view],
  );

  const pv = usePreview({
    squad,
    startIds,
    captainId: realCaptain,
    bank: view?.bankM ?? 0,
    gw: futureGw ?? view?.horizon[0] ?? null,
  });

  const selectedPlayer = pv.state?.squad.find((p) => p.element === selected) ?? null;

  // Replacement candidates for the selected player.
  const replacements = useMemo(() => {
    if (!selectedPlayer || !playersLive || !projections || !pv.state) return [];
    const owned = new Set(pv.state.squad.map((p) => p.element));
    const budget = pv.state.bank + selectedPlayer.price;
    const gw = futureGw ?? view?.horizon[0] ?? null;
    const q = search.trim().toLowerCase();
    return playersLive
      .filter(
        (p) =>
          p.position === selectedPlayer.position &&
          ["a", "d"].includes(p.status) &&
          !owned.has(p.element) &&
          p.price_m <= budget &&
          (q === "" || p.web_name.toLowerCase().includes(q)),
      )
      .map((p) => {
        const per = projections.players[String(p.element)]?.per_gw ?? [];
        return {
          player: {
            element: p.element,
            name: p.web_name,
            position: p.position as Position,
            team: p.team_short ?? "?",
            price: p.price_m,
            gws: new Map(per.map((g) => [g.gw, g.xp])),
          } as PreviewPlayer,
          xp: gw === null ? 0 : (per.find((g) => g.gw === gw)?.xp ?? 0),
        };
      })
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 12);
  }, [selectedPlayer, playersLive, projections, pv.state, futureGw, view, search]);

  const submit = () => {
    const trimmed = input.trim();
    setEntryId(/^\d+$/.test(trimmed) ? trimmed : null);
  };

  const onSelect = (element: number) => {
    if (selected === null) { setSelected(element); return; }
    if (selected === element) { setSelected(null); return; }
    pv.swap(selected, element);
    setSelected(null);
    setSearch("");
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="text-sm text-ink-muted">Your FPL entry ID</label>
        <div className="flex gap-2 mt-1">
          <input
            className="input flex-1 max-w-xs"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn-brand" onClick={submit}>Load squad</button>
        </div>
        <p className="text-[11px] text-ink-faint mt-1.5">
          Find it in the FPL site URL: <code>/entry/<b>1234567</b>/event/…</code>. Stored only in
          your browser — no login, no password (the public API is read-only).
        </p>
      </div>

      {error && (
        <div className="card p-4 text-fdr-5 text-sm">
          Couldn’t load that entry: {(error as Error).message}. Check the ID, or the Worker may be
          offline (<code>cd worker &amp;&amp; npm run dev</code>).
        </div>
      )}

      {isLoading && <div className="skeleton h-96 w-full" />}

      {view && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-3">
            <div className="card p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-ink">{view.teamName}</h1>
                  <div className="text-sm text-ink-muted flex items-center gap-2 flex-wrap">
                    <span>{view.managerName} · GW {currentGw}</span>
                    {view.activeChip && (
                      <span className="pill bg-brand-dim text-surface-0">{view.activeChip}</span>
                    )}
                    {live.isLive && futureGw === null && !preview && (
                      <span className="pill bg-fdr-5 text-white animate-pulse">LIVE</span>
                    )}
                    {live.view?.anyProvisional && !preview && (
                      <span className="pill bg-fdr-4/20 text-fdr-4"
                        title="Bonus computed live from BPS; official bonus is added after each match">
                        bonus provisional*
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
                <Stat label="Overall rank" value={fmtInt(view.overallRank)} />
                <Stat label="Overall pts" value={fmtInt(view.overallPoints)} />
                <Stat
                  label={live.isLive && futureGw === null ? "GW pts (live)" : "GW pts"}
                  value={String(live.view?.runningTotal ?? view.gwPoints)}
                  highlight={live.isLive && futureGw === null}
                />
                <Stat label="Bank" value={fmtPrice(preview && pv.state ? pv.state.bank : view.bankM)} />
                <Stat label="Squad value" value={fmtPrice(view.squadValueM)} />
                <Stat label="Bench pts" value={String(view.benchPoints)} />
              </div>
            </div>

            {/* Gameweek stepper + preview toggle */}
            {gwList.length > 0 && (
              <div className="card p-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn !px-2.5"
                  onClick={() => stepGw(-1)}
                  disabled={gwIndex <= 0}
                  aria-label="Previous gameweek"
                >
                  ◀
                </button>
                <div className="text-center min-w-[104px]">
                  <div className="text-sm font-semibold text-ink">
                    GW{shownGw}
                    {futureGw === null && (
                      <span className="text-ink-faint font-normal text-xs">
                        {live.isLive ? " · live" : " · now"}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-faint tabular-nums">
                    {futureGw === null
                      ? `${live.view?.runningTotal ?? view.gwPoints} pts`
                      : `${(preview ? pv.total : (view.totalsByGw.get(futureGw) ?? 0)).toFixed(1)} projected`}
                  </div>
                </div>
                <button
                  className="btn !px-2.5"
                  onClick={() => stepGw(1)}
                  disabled={gwIndex < 0 || gwIndex >= gwList.length - 1}
                  aria-label="Next gameweek"
                >
                  ▶
                </button>

                <div className="h-6 w-px bg-surface-3 mx-1" />

                <button
                  onClick={() => { setPreview((v) => !v); setSelected(null); }}
                  className={`pill border ${
                    preview
                      ? "bg-brand-dim text-surface-0 border-brand"
                      : "bg-surface-2 text-ink-muted border-surface-3 hover:text-ink"
                  }`}
                  title="Rearrange your squad without saving anything"
                >
                  {preview ? "● Preview mode" : "Preview mode"}
                </button>

                {preview && (
                  <>
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-ink-faint">Formation</span>
                      <select
                        className="input !py-1"
                        value={pv.formation ? formationLabel(pv.formation) : ""}
                        onChange={(e) => {
                          const f = FORMATIONS.find((x) => formationLabel(x) === e.target.value);
                          if (f) pv.setFormation(f);
                        }}
                      >
                        {!pv.formation && <option value="">—</option>}
                        {FORMATIONS.map((f) => (
                          <option key={formationLabel(f)} value={formationLabel(f)}>
                            {formationLabel(f)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn" onClick={pv.autoPick} title="Field the best legal XI for this gameweek">
                      Auto-pick
                    </button>
                    <button
                      className="btn"
                      onClick={() => { pv.reset(); setSelected(null); }}
                      disabled={!pv.state?.dirty}
                    >
                      Reset
                    </button>
                    {pv.state?.dirty && (
                      <span className="pill bg-fdr-4/20 text-fdr-4 text-[10px]">unsaved preview</span>
                    )}
                  </>
                )}

                {futureGw !== null && !preview && (
                  <span className="text-[11px] text-ink-faint ml-auto">
                    Your current squad against GW{futureGw}’s fixtures.
                  </span>
                )}
              </div>
            )}

            {preview && (
              <div className="card p-3 text-[11px] text-ink-faint">
                <span className="text-ink font-medium">Preview mode: </span>
                nothing here is saved and your real team is untouched — this app never signs in to
                FPL. Tap a player to select, tap another to swap them, or use the actions below to
                captain or replace the selected player.
              </div>
            )}

            {futureGw === null && !preview && live.view && live.view.subs.length > 0 && (
              <div className="card p-3 text-xs text-ink-muted">
                <span className="text-ink font-medium">Auto-subs: </span>
                {live.view.subs.map((sub, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="text-brand">{sub.inName}</span> in for {sub.outName}
                  </span>
                ))}
              </div>
            )}

            {preview ? (
              <>
                <PreviewPitch
                  xi={pv.xi}
                  bench={pv.bench}
                  gw={futureGw ?? view.horizon[0] ?? null}
                  captainId={pv.state?.captainId ?? null}
                  selectedId={selected}
                  onSelect={onSelect}
                />

                {selectedPlayer && (
                  <div className="card p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`pill ${positionColor(selectedPlayer.position)}`}>
                        {selectedPlayer.position}
                      </span>
                      <span className="text-ink font-medium">{selectedPlayer.name}</span>
                      <TeamBadge team={selectedPlayer.team} size={16} />
                      <span className="text-xs text-ink-faint">{fmtPrice(selectedPlayer.price)}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          className="btn"
                          onClick={() => pv.setCaptain(selectedPlayer.element)}
                          disabled={!pv.state?.startIds.has(selectedPlayer.element)}
                          title={
                            pv.state?.startIds.has(selectedPlayer.element)
                              ? "Give this player the armband"
                              : "Only a starting player can captain"
                          }
                        >
                          Make captain
                        </button>
                        <button className="btn" onClick={() => { setSelected(null); setSearch(""); }}>
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm text-ink font-medium">Replace with</span>
                        <input
                          className="input !py-1 text-xs max-w-[180px]"
                          placeholder="search…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <span className="text-[11px] text-ink-faint ml-auto">
                          Budget {fmtPrice((pv.state?.bank ?? 0) + selectedPlayer.price)}
                        </span>
                      </div>
                      {replacements.length === 0 ? (
                        <p className="text-xs text-ink-faint">
                          No affordable replacement in this position{search ? " matching that search" : ""}.
                        </p>
                      ) : (
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {replacements.map(({ player, xp }) => (
                            <li key={player.element}>
                              <button
                                className="w-full flex items-center gap-2 text-xs bg-surface-2 hover:bg-surface-3 rounded-md px-2 py-1.5 text-left"
                                onClick={() => {
                                  pv.transfer(selectedPlayer.element, player);
                                  setSelected(null);
                                  setSearch("");
                                }}
                              >
                                <span className="text-ink">{player.name}</span>
                                <TeamBadge team={player.team} size={13} />
                                <span className="text-ink-faint ml-auto tabular-nums">
                                  {fmtPrice(player.price)}
                                </span>
                                <span className="text-brand tabular-nums w-8 text-right">
                                  {xp.toFixed(1)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-[11px] text-ink-faint mt-2">
                        Sorted by projected points for GW{futureGw ?? view.horizon[0]}. Selling price
                        is approximated by current price — the public API doesn’t expose what you
                        paid, so a risen player overstates your budget slightly.
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Pitch rows={view.rows} bench={view.bench} live={liveByElement} futureGw={futureGw} />
            )}

            {live.isLive && futureGw === null && !preview && (
              <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                <span>Auto-refreshing every 30s while matches are in play.</span>
                <button className="btn ml-auto" onClick={live.refetch} disabled={live.isFetching}>
                  {live.isFetching ? "refreshing…" : "↻ refresh"}
                </button>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="card p-4">
              <div className="text-xs uppercase tracking-wide text-ink-faint">
                {preview ? `Preview XI · GW${futureGw ?? view.horizon[0]}` : "Projected next GW (our model)"}
              </div>
              {preview ? (
                <>
                  <div className="text-3xl font-semibold text-brand mt-1 tabular-nums">
                    {pv.total.toFixed(1)}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-sm">
                    <span className="text-ink-muted">Your real XI</span>
                    <span className="text-ink font-semibold tabular-nums">
                      {(view.totalsByGw.get(futureGw ?? view.horizon[0]!) ?? 0).toFixed(1)}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-faint mt-2">
                    Projected points for the eleven you have set here, captain doubled. Compare
                    against your real XI above — a preview that scores lower is telling you the
                    change costs points.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-3xl font-semibold text-brand mt-1">
                    {view.modelNextGw.xp.toFixed(1)}
                    <span className="text-sm text-ink-faint font-normal ml-2">
                      {view.modelNextGw.low.toFixed(0)}–{view.modelNextGw.high.toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-sm">
                    <span className="text-ink-muted">Next 5 GWs</span>
                    <span className="text-ink font-semibold tabular-nums">
                      {view.modelNext5.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-faint mt-2">
                    XI projected xP (captain doubled) with a 10–90% Monte-Carlo band. Beats last-6,
                    season-PPG and last-3 baselines on rank correlation (see backtest). Early in a
                    season, projections lean on positional priors until form accrues.
                    {view.modelNextGw.covered < view.modelNextGw.total &&
                      ` ${view.modelNextGw.total - view.modelNextGw.covered} player(s) unprojected.`}
                  </p>
                </>
              )}
            </div>

            {view.chipPlan.length > 0 && (
              <div className="card p-4">
                <div className="text-sm text-ink font-medium mb-1.5">Chip strategy</div>
                <ul className="space-y-1.5">
                  {view.chipPlan.map((c) => (
                    <li key={c.chip} className="text-xs">
                      <button
                        onClick={() => setFutureGw(c.gw)}
                        className="text-left w-full hover:text-ink"
                        title={`Preview GW${c.gw}`}
                      >
                        <span className="text-brand font-medium">{c.chip}</span>
                        <span className="text-ink-muted"> → GW{c.gw}</span>
                        <div className="text-ink-faint">{c.detail}</div>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-ink-faint mt-2">
                  Where each unused chip looks best across the projected horizon. A lean, not a
                  recommendation — fixtures, injuries and your own transfers will move these.
                </p>
              </div>
            )}

            <div className="card p-4">
              <div className="text-sm text-ink font-medium mb-1.5">Chips</div>
              <div className="text-xs text-ink-muted space-y-1">
                <div>
                  <span className="text-ink-faint">Used: </span>
                  {view.chipsUsed.length
                    ? view.chipsUsed.map((c) => `${c.label} (GW${c.event})`).join(", ")
                    : "none"}
                </div>
                <div>
                  <span className="text-ink-faint">Available: </span>
                  {view.chipsAvailable.length ? view.chipsAvailable.join(", ") : "none"}
                </div>
              </div>
            </div>

            {view.rating && (
              <div className="card p-4">
                <div className="flex items-baseline justify-between">
                  <div className="text-sm text-ink font-medium">Team rating</div>
                  <div className="text-2xl font-semibold text-brand tabular-nums">
                    {view.rating.overall}
                    <span className="text-sm text-ink-faint font-normal">/100</span>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {view.rating.subs.map((s) => (
                    <div key={s.label} title={s.detail}>
                      <div className="flex justify-between text-xs">
                        <span className="text-ink-muted">{s.label}</span>
                        <span className="text-ink tabular-nums">{s.score}</span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded mt-0.5">
                        <div className="h-1.5 bg-brand-dim rounded" style={{ width: `${s.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-ink-faint mt-2">
                  Scored against the optimiser's optimal squad over the next 5 GWs. Hover each bar
                  for the numbers behind it.
                </p>
              </div>
            )}

            <div className="card p-4">
              <div className="text-sm text-ink font-medium mb-1.5">Suggested transfers</div>
              {view.suggestions.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  No single-transfer upgrade improves your projected next-5 points right now.
                </p>
              ) : (
                <ul className="space-y-2">
                  {view.suggestions.map((s, i) => (
                    <li key={i} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink">
                          <span className="text-fdr-5">{s.outName}</span> →{" "}
                          <span className="text-brand">{s.inName}</span>
                        </span>
                        <span className="pill bg-surface-2 text-brand">+{s.delta.toFixed(1)} xP</span>
                      </div>
                      <div className="text-ink-faint">
                        {s.position} ·{" "}
                        {s.costChange >= 0
                          ? `−£${s.costChange.toFixed(1)}`
                          : `+£${(-s.costChange).toFixed(1)}`}{" "}
                        bank
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-ink-faint mt-2">
                Quick single-transfer upgrades. For multi-transfer plans with hits costed, see the{" "}
                <Link to="/planner" className="text-brand">Transfers &amp; Captaincy</Link> page.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-md p-2 ${highlight ? "bg-brand-dim/20 ring-1 ring-brand/30" : "bg-surface-2"}`}>
      <div className="text-[10px] uppercase text-ink-faint">{label}</div>
      <div className={`font-semibold tabular-nums text-sm ${highlight ? "text-brand" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
