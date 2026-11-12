import { useQuery } from "@tanstack/react-query";

import { fetchManifest } from "../lib/api";
import { fmtDate } from "../lib/format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-ink font-medium mb-1.5">{title}</h2>
      <div className="text-sm text-ink-muted space-y-2">{children}</div>
    </section>
  );
}

export function AboutRoute() {
  const { data } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">About &amp; data limitations</h1>

      <Section title="What this is">
        <p>
          One place for FPL decisions: deep stats, model-based projections, fixture difficulty, an
          optimiser, and live scoring — merged from the three sites managers usually juggle. Built
          stats-first, and honest about what the data can and cannot support.
        </p>
      </Section>

      <Section title="The honest data limits">
        <p>
          The official FPL API does <b>not</b> expose 15 seasons of player-level gameweek data. This
          app uses:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Player gameweek data from <b>2020-21 → present</b> (the community archive), the clean,
            schema-consistent window with position and xG columns.
          </li>
          <li>The projection model is trained on that window; 2016-17 → present informs long-run positional priors only.</li>
          <li>
            xG/xA are in the feed from <b>2022-23</b> onward; earlier seasons fall back to actual
            goals for team strength.
          </li>
          <li>
            FPL's own <code>ep_next</code> is a live-only field, absent from the historical archive —
            so it cannot be a historical backtest baseline.
          </li>
        </ul>
        <p>Nothing in this app implies granular history that does not exist.</p>
      </Section>

      <Section title="Are the projections any good?">
        {data?.model ? (
          <p>
            Yes, by the bar we set ourselves. In a walk-forward backtest across{" "}
            {data.model.seasons.join(", ")}, the model's per-gameweek rank correlation with actual
            points was <b className="text-brand">{data.model.model_spearman.toFixed(3)}</b>, beating
            the best baseline ({data.model.best_baseline}:{" "}
            {data.model.best_baseline_spearman.toFixed(3)}). We only ship projections that beat every
            baseline on rank correlation — otherwise we'd ship the baseline and say so.
          </p>
        ) : (
          <p>The backtest summary isn't loaded.</p>
        )}
        <p>
          Projections are decomposed: a minutes model, then attacking returns, clean sheets, bonus
          and peripherals, assembled with a Monte-Carlo band. Early in a season they lean on
          positional priors until form accrues — so premium attackers rise over the first few weeks.
        </p>
      </Section>

      <Section title="Heuristics we label as such">
        <ul className="list-disc pl-5 space-y-1">
          <li>The price predictor is a transparent net-transfer-momentum heuristic — not FPL's real, undisclosed algorithm.</li>
          <li>Attack/defence fixture difficulty is derived from opponent strength; the official 1-5 FDR is a toggle.</li>
          <li>Provisional live bonus is computed from live BPS and verified to match official bonus exactly on completed gameweeks.</li>
          <li>Transfer suggestions are greedy single-transfer upgrades; selling price is approximated by current price (the public API doesn't expose per-pick purchase price).</li>
        </ul>
      </Section>

      <Section title="Privacy & architecture">
        <p>
          No login, no accounts, no passwords. Your entry ID and preferences live only in your
          browser. Static data (stats, projections, fixtures) is precomputed and queried in-browser
          with DuckDB-WASM; live data is proxied through a thin edge Worker that adds CORS and caches
          — the only server-side component.
        </p>
        {data && (
          <p className="text-ink-faint text-xs">
            Data as of {fmtDate(data.data_as_of)} · {data.current_season} GW {data.current_gw ?? "—"}{" "}
            · build {data.git_sha}
          </p>
        )}
      </Section>
    </div>
  );
}
