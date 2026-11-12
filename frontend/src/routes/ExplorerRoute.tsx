import { useQuery } from "@tanstack/react-query";
import { type SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { fetchManifest } from "../lib/api";
import type { PlayerForm } from "../lib/types";
import { EXPLORER_COLUMNS } from "../features/explorer/columns";
import { defaultFilters, type ExplorerFilters } from "../features/explorer/filterModel";
import { Filters } from "../features/explorer/Filters";
import { ExplorerTable } from "../features/explorer/ExplorerTable";
import { PlayerProfile } from "../features/explorer/PlayerProfile";
import { useExplorerData, useSeasonTeams } from "../features/explorer/useExplorerData";

function exportCsv(rows: PlayerForm[]): void {
  const cols = ["name", "team_name", "position", "price_m", ...EXPLORER_COLUMNS.map((c) => c.key)];
  const header = cols.join(",");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = (r as unknown as Record<string, unknown>)[c];
          if (typeof v === "string" && v.includes(",")) return `"${v}"`;
          return v ?? "";
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fpl-explorer.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ExplorerRoute() {
  const { data: manifest } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });
  const [filters, setFilters] = useState<ExplorerFilters | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: "season_points", desc: true }]);
  const [selected, setSelected] = useState<PlayerForm | null>(null);

  // Initialise filters once the manifest (season list) is known.
  const activeFilters = useMemo<ExplorerFilters | null>(() => {
    if (filters) return filters;
    if (!manifest) return null;
    // Default to the live season — that's the one managers are picking for.
    return defaultFilters(manifest.current_season);
  }, [filters, manifest]);

  const orderBy = sorting[0]?.id ?? "season_points";
  const desc = sorting[0]?.desc ?? true;

  const { data, isLoading, isError, error } = useExplorerData(
    activeFilters ?? defaultFilters(manifest?.current_season ?? ""),
    orderBy,
    desc,
  );
  const { data: teams } = useSeasonTeams(activeFilters?.season ?? "");

  if (!activeFilters || !manifest) {
    return <div className="skeleton h-64 w-full" />;
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      <Filters
        filters={activeFilters}
        onChange={setFilters}
        seasons={manifest.seasons}
        teams={teams ?? []}
        resultCount={rows.length}
        elapsedMs={data?.elapsedMs ?? null}
        onExportCsv={() => exportCsv(rows)}
      />

      {isError ? (
        <div className="card p-6 text-fdr-5 text-sm">
          Failed to load data: {(error as Error)?.message}. Run{" "}
          <code>uv run python -m pipeline.run_publish</code> to generate the bundles.
        </div>
      ) : (
        <ExplorerTable
          rows={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          onSelect={setSelected}
          loading={isLoading}
        />
      )}

      <p className="text-[11px] text-ink-faint">
        Filtering runs entirely in your browser via DuckDB-WASM over the published parquet. Shots,
        key passes and big chances are not in the FPL feed — they arrive with the model in M4.
      </p>

      {selected && <PlayerProfile player={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
