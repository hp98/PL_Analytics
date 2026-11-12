"""As-of baselines the model must beat on rank correlation (§6 gate).

FPL's own ``ep_next`` is a live-only field absent from the historical archive, so
it cannot be a historical baseline; the achievable stand-ins below are used and
this is stated in the report. Every baseline is shifted so it only uses matches
before the row it scores.
"""

from __future__ import annotations

import pandas as pd


def add_baselines(df: pd.DataFrame) -> pd.DataFrame:
    """Add last6_avg, last3_avg and season_ppg baseline columns (as-of)."""
    df = df.sort_values(["kickoff_time", "fixture_id", "element"]).copy()
    g = df.groupby(["season", "element"], group_keys=False, sort=False)

    df["last6_avg"] = g["total_points"].apply(
        lambda s: s.shift(1).rolling(6, min_periods=1).mean()
    )
    df["last3_avg"] = g["total_points"].apply(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean()
    )
    df["season_ppg"] = g["total_points"].apply(lambda s: s.shift(1).expanding().mean())

    # Cold-start (a player's first match of the season) → 0, a neutral guess.
    for col in ("last6_avg", "last3_avg", "season_ppg"):
        df[col] = df[col].fillna(0.0)
    return df
