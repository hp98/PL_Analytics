import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchManifest } from "../lib/api";
import { fmtInt } from "../lib/format";

export function HomeRoute() {
  const { data } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });
  const fctRows = data?.parquet_tables.find((t) => t.name === "fct_player_gameweek")?.rows;

  return (
    <div className="space-y-6">
      <section className="card hero p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
          One place for every FPL decision.
        </h1>
        <p className="mt-2 text-ink-muted max-w-2xl">
          Deep player stats, fixture difficulty, projections, live scoring and transfer planning —
          merged from the three sites managers juggle on a Friday night. Built stats-first: a
          trustworthy explorer before any projection you can’t validate.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/explorer" className="btn-brand">
            Open Player Explorer →
          </Link>
          <Link to="/fixtures" className="btn">
            Fixture Ticker →
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Seasons of history" value={data ? String(data.seasons.length) : "—"} sub="2020-21 → present" />
        <Stat label="Player-gameweeks" value={fctRows ? fmtInt(fctRows) : "—"} sub="queried in your browser" />
        <Stat label="Current season" value={data?.current_season ?? "—"} sub={`GW ${data?.current_gw ?? "—"} played`} />
      </section>

      {data?.model && (
        <section className="card p-5 text-sm">
          <h2 className="text-ink font-medium mb-1">
            Projections are validated {data.model.ship_model ? "✅" : "⚠️"}
          </h2>
          <p className="text-ink-muted">
            In a walk-forward backtest ({data.model.seasons.join(", ")}), the model’s rank
            correlation with actual points{" "}
            <span className="text-brand font-medium">{data.model.model_spearman.toFixed(3)}</span>{" "}
            {data.model.ship_model ? "beats" : "trails"} the best baseline (
            {data.model.best_baseline}: {data.model.best_baseline_spearman.toFixed(3)}). We only ship
            projections that clear that bar.
          </p>
        </section>
      )}

      <section className="card p-5 text-sm text-ink-muted">
        <h2 className="text-ink font-medium mb-1">Honest about the data</h2>
        <p>
          The official FPL API does not expose 15 seasons of granular player data. Projections are
          trained on 2020-21 → present, with 2016-17 → present used only for long-run positional
          priors. FPL’s own <code>ep_next</code> isn’t in the archive, so it can’t be a historical
          baseline. Nothing here implies history that does not exist.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-2xl font-semibold text-ink mt-1">{value}</div>
      <div className="text-xs text-ink-muted mt-0.5">{sub}</div>
    </div>
  );
}
