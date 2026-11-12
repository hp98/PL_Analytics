import { useState } from "react";

import type { Position } from "../../lib/types";
import { useUiStore } from "../../store/useUiStore";
import { NUMERIC_FILTER_COLUMNS } from "./columns";
import { defaultFilters, type ExplorerFilters, type NumericOp } from "./filterModel";

const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];
const OPS: NumericOp[] = [">=", "<=", ">", "<", "="];

interface Props {
  filters: ExplorerFilters;
  onChange: (f: ExplorerFilters) => void;
  seasons: string[];
  teams: string[];
  resultCount: number;
  elapsedMs: number | null;
  onExportCsv: () => void;
}

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function Filters(props: Props) {
  const { filters, onChange, seasons, teams, resultCount, elapsedMs, onExportCsv } = props;
  const presets = useUiStore((s) => s.presets);
  const savePreset = useUiStore((s) => s.savePreset);
  const deletePreset = useUiStore((s) => s.deletePreset);
  const [teamsOpen, setTeamsOpen] = useState(false);

  const set = (patch: Partial<ExplorerFilters>) => onChange({ ...filters, ...patch });

  const togglePosition = (p: Position) =>
    set({
      positions: filters.positions.includes(p)
        ? filters.positions.filter((x) => x !== p)
        : [...filters.positions, p],
    });

  const toggleTeam = (t: string) =>
    set({
      teams: filters.teams.includes(t)
        ? filters.teams.filter((x) => x !== t)
        : [...filters.teams, t],
    });

  return (
    <div className="card p-3 space-y-3">
      {/* Row 1: season, search, positions */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-faint">Season</label>
        <select
          className="input"
          value={filters.season}
          onChange={(e) => onChange({ ...defaultFilters(e.target.value) })}
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          className="input flex-1 min-w-[140px]"
          placeholder="Search player…"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />

        <div className="flex items-center gap-1">
          {POSITIONS.map((p) => {
            const active = filters.positions.includes(p);
            return (
              <button
                key={p}
                onClick={() => togglePosition(p)}
                className={`pill border ${
                  active
                    ? "bg-brand-dim text-surface-0 border-brand"
                    : "bg-surface-2 text-ink-muted border-surface-3"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 2: teams, price, minutes, stat filter */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="relative">
          <button className="btn" onClick={() => setTeamsOpen((o) => !o)}>
            Teams {filters.teams.length > 0 ? `(${filters.teams.length})` : "· all"}
          </button>
          {teamsOpen && (
            <div className="absolute z-30 mt-1 max-h-64 w-56 overflow-auto card p-2 shadow-xl">
              {teams.map((t) => (
                <label key={t} className="flex items-center gap-2 px-1 py-0.5 hover:bg-surface-2 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.teams.includes(t)}
                    onChange={() => toggleTeam(t)}
                  />
                  <span className="text-ink-muted">{t}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-faint">£</span>
          <input
            type="number" step="0.1" className="input w-16" placeholder="min"
            value={filters.priceMin ?? ""}
            onChange={(e) => set({ priceMin: numOrNull(e.target.value) })}
          />
          <span className="text-ink-faint">–</span>
          <input
            type="number" step="0.1" className="input w-16" placeholder="max"
            value={filters.priceMax ?? ""}
            onChange={(e) => set({ priceMax: numOrNull(e.target.value) })}
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-faint">Min mins ≥</span>
          <input
            type="number" className="input w-20" placeholder="0"
            value={filters.minMinutes ?? ""}
            onChange={(e) => set({ minMinutes: numOrNull(e.target.value) })}
          />
        </div>

        <div className="flex items-center gap-1">
          <select
            className="input"
            value={filters.statColumn ?? ""}
            onChange={(e) => set({ statColumn: e.target.value || null })}
          >
            <option value="">Stat filter…</option>
            {NUMERIC_FILTER_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="input w-14"
            value={filters.statOp}
            onChange={(e) => set({ statOp: e.target.value as NumericOp })}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            type="number" className="input w-20" placeholder="value"
            value={filters.statValue ?? ""}
            onChange={(e) => set({ statValue: numOrNull(e.target.value) })}
          />
        </div>
      </div>

      {/* Row 3: presets, export, result meta */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className="btn"
          onClick={() => {
            const name = window.prompt("Save this filter as:");
            if (name) savePreset(name, filters);
          }}
        >
          💾 Save preset
        </button>
        {Object.keys(presets).length > 0 && (
          <select
            className="input"
            value=""
            onChange={(e) => {
              const p = presets[e.target.value];
              if (p) onChange(p);
            }}
          >
            <option value="">Load preset…</option>
            {Object.keys(presets).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {Object.keys(presets).map((name) => (
          <button
            key={name}
            className="pill bg-surface-2 text-ink-faint hover:text-fdr-5"
            title={`Delete preset "${name}"`}
            onClick={() => deletePreset(name)}
          >
            {name} ✕
          </button>
        ))}

        <button className="btn ml-auto" onClick={onExportCsv}>
          ⬇ CSV
        </button>
        <span className="text-xs text-ink-muted">
          {resultCount.toLocaleString()} players
          {elapsedMs !== null && (
            <span className={`ml-2 pill ${elapsedMs < 200 ? "text-brand" : "text-fdr-4"}`}>
              {elapsedMs.toFixed(0)} ms
            </span>
          )}
        </span>
        <button className="btn" onClick={() => onChange(defaultFilters(filters.season))}>
          Reset
        </button>
      </div>
    </div>
  );
}
