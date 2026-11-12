import { useQuery } from "@tanstack/react-query";

import { fetchManifest } from "../lib/api";
import { fmtDate } from "../lib/format";

// Freshness indicator (§10). Three different things age at different rates, and
// showing only the oldest made the app look stale when it wasn't:
//   - completed-match stats  -> last finished gameweek (can be days old between GWs)
//   - projections/optimiser  -> the pipeline build time
//   - My Team / Live / prices -> fetched live, always current
// So we label the stats explicitly and spell the rest out on hover.
export function DataFreshness() {
  // No polling: the manifest only changes when the pipeline republishes, and
  // the shared static-bundle policy (main.tsx) already caches and revalidates it.
  const { data, isPending, isError } = useQuery({
    queryKey: ["manifest"],
    queryFn: fetchManifest,
  });

  if (isPending) return <div className="skeleton h-5 w-40" />;
  // Only admit defeat when we have nothing at all. A failed revalidation while a
  // previous manifest is still cached must keep showing that one -- briefly
  // flashing "data unavailable" over good data is worse than being a little old.
  if (!data) {
    return isError ? <span className="text-xs text-fdr-5">data unavailable</span> : null;
  }

  const statsGw = data.data_as_of_gw;
  const tip =
    `Completed-match stats: through GW${statsGw ?? "?"} (last match ${fmtDate(data.data_as_of)}).
` +
    `Projections & optimal squad: built ${fmtDate(data.build_timestamp)}.
` +
    `My Team, Live GW, prices and leagues are fetched live — always current.`;

  return (
    <div className="text-right text-xs leading-tight text-ink-muted cursor-help" title={tip}>
      <div>
        stats through{" "}
        <span className="text-ink">GW{statsGw ?? "—"}</span>
        <span className="text-ink-faint"> · live data current</span>
      </div>
      <div className="text-ink-faint">
        {data.current_season} · GW {data.current_gw ?? "—"} in play · built{" "}
        {fmtDate(data.build_timestamp)}
      </div>
    </div>
  );
}
