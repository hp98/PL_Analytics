# Projection backtest

_Generated 2026-09-02T06:16:19.752469+00:00_

Walk-forward across 2023-24, 2024-25, 2025-26. Minutes model trained on strictly-earlier seasons; statistical stages use as-of data only. Evaluated over the relevant-player pool (39,596 of 87,077 player-gameweeks).

✅ **The model beats every baseline on rank correlation — projections may ship.**

| predictor | Spearman (per-GW) | Spearman (pooled) | MAE |
|---|---|---|---|
| xp | 0.3540 | 0.3430 | 1.894 |
| last6_avg | 0.2811 | 0.2763 | 2.085 |
| last3_avg | 0.2672 | 0.2633 | 2.185 |
| season_ppg | 0.3019 | 0.2946 | 1.990 |

## Notes
- FPL `ep_next` is live-only and absent from the historical archive, so it cannot be a historical baseline; last6_avg / last3_avg / season_ppg stand in.
- Primary gate metric is mean per-gameweek Spearman over the relevant-player pool.
