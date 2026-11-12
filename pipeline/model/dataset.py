"""Load the player-fixture fact and engineer leakage-safe, as-of features.

Every rolling/expanding feature is shifted so a row only ever sees matches that
kicked off strictly before it. Team attack/defence strength is an EWMA of past
match xG, keyed by team NAME (stable across seasons, unlike the season-scoped
team id).
"""

from __future__ import annotations

import duckdb
import numpy as np
import pandas as pd

from pipeline.config import Config

# Columns pulled from the warehouse fact.
_FACT_COLUMNS = [
    "season", "gw", "element", "name", "position", "team_name", "team_id",
    "opponent_team_id", "fixture_id", "was_home", "kickoff_time", "minutes",
    "starts", "total_points", "goals_scored", "assists", "clean_sheets",
    "goals_conceded", "saves", "yellow_cards", "red_cards", "bonus", "bps",
    "expected_goals", "expected_assists", "value", "selected",
    "transfers_balance", "team_h_score", "team_a_score",
]


def _load_fact(cfg: Config) -> pd.DataFrame:
    con = duckdb.connect(str(cfg.paths.warehouse / "fpl.duckdb"), read_only=True)
    try:
        df = con.execute(
            f"select {', '.join(_FACT_COLUMNS)} from fct_player_gameweek"
        ).df()
    finally:
        con.close()
    df["kickoff_time"] = pd.to_datetime(df["kickoff_time"], utc=True)
    # A stable global order for as-of computations.
    df = df.sort_values(["kickoff_time", "fixture_id", "element"]).reset_index(drop=True)
    return df


def team_match_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per (season, fixture, team) with xG for/against and kickoff.

    xG-for is the sum of the team's players' expected_goals (falling back to
    actual goals pre-2022-23); xG-against is the opponent's xG-for in the same
    fixture. Keyed by team NAME so identity is stable across seasons.
    """
    name_by = df.drop_duplicates(["season", "team_id"]).set_index(["season", "team_id"])[
        "team_name"
    ]
    opp_name = df.set_index(["season", "opponent_team_id"]).index.map(name_by)
    df = df.assign(opponent_name=opp_name.to_numpy())

    grp = df.groupby(["season", "fixture_id", "team_name", "opponent_name"], as_index=False)
    tm = grp.agg(
        kickoff_time=("kickoff_time", "first"),
        was_home=("was_home", "first"),
        team_h_score=("team_h_score", "first"),
        team_a_score=("team_a_score", "first"),
        xg_sum=("expected_goals", "sum"),
        xg_notna=("expected_goals", lambda s: s.notna().any()),
    )
    tm["goals_for"] = np.where(tm["was_home"], tm["team_h_score"], tm["team_a_score"])
    tm["goals_against"] = np.where(tm["was_home"], tm["team_a_score"], tm["team_h_score"])
    tm["xg_for"] = np.where(tm["xg_notna"], tm["xg_sum"], tm["goals_for"]).astype(float)
    opp = tm[["season", "fixture_id", "team_name", "xg_for"]].rename(
        columns={"team_name": "opponent_name", "xg_for": "xg_against"}
    )
    tm = tm.merge(opp, on=["season", "fixture_id", "opponent_name"], how="left")
    tm["xg_against"] = tm["xg_against"].fillna(tm["goals_against"].astype(float))
    return tm.sort_values("kickoff_time").reset_index(drop=True)


def _team_strength(df: pd.DataFrame, halflife: float) -> pd.DataFrame:
    """Per (fixture, team) as-of attack/defence xG EWMA (shifted, no leakage)."""
    tm = team_match_table(df)
    g = tm.groupby("team_name", group_keys=False)
    tm["att_ewma"] = g["xg_for"].apply(lambda s: s.ewm(halflife=halflife).mean().shift(1))
    tm["def_ewma"] = g["xg_against"].apply(lambda s: s.ewm(halflife=halflife).mean().shift(1))
    # `season` is part of the key: FPL fixture ids repeat 1..380 every season.
    return tm[["season", "fixture_id", "team_name", "att_ewma", "def_ewma"]]


def current_team_strength(df: pd.DataFrame, halflife: float) -> pd.DataFrame:
    """Latest attack/defence EWMA per team (INCLUDING the most recent match).

    Used by the live forecast — unlike the backtest EWMA this is not shifted, so
    it reflects the team's strength as of right now.
    """
    tm = team_match_table(df)
    g = tm.groupby("team_name", group_keys=False)
    tm["att_now"] = g["xg_for"].apply(lambda s: s.ewm(halflife=halflife).mean())
    tm["def_now"] = g["xg_against"].apply(lambda s: s.ewm(halflife=halflife).mean())
    return tm.groupby("team_name", as_index=False).tail(1)[["team_name", "att_now", "def_now"]]


def _roll_shift(s: pd.Series, window: int, fn: str) -> pd.Series:
    r = s.rolling(window, min_periods=1)
    return (r.mean() if fn == "mean" else r.sum()).shift(1)


# Columns carried across seasons into the empirical-Bayes prior.
CARRY_COLS = ["xg", "xa", "minutes", "bps", "saves"]


def career_carry_in(df: pd.DataFrame, halflife: float) -> pd.DataFrame:
    """Recency-weighted totals from STRICTLY EARLIER seasons, per player-season.

    The shrinkage stage blends a player's own per-90 rate with a positional
    prior, weighted by minutes. Those minutes used to reset each season, so
    early in a campaign a proven player was treated as ~83% "average for their
    position". Carrying prior seasons in with an exponential decay keeps the
    prior informative from GW1 while still letting current form take over.

    Keyed on NAME, not element: FPL reassigns element ids every season (id 411
    has been six different players since 2020-21), and player_nk is hashed per
    season, so either would silently blend unrelated careers. The handful of
    names that map to more than one element within a season are ambiguous, so
    they are dropped and fall back to the positional prior.

    Only seasons strictly before the target season contribute, so this adds
    evidence without look-ahead and remains valid for walk-forward backtesting.
    """
    dupes = (
        df.groupby(["season", "name"])["element"].nunique().pipe(lambda s: s[s > 1]).index
    )
    ambiguous = {name for _, name in dupes}
    clean = df[~df["name"].isin(ambiguous)]

    order = {s: i for i, s in enumerate(sorted(df["season"].unique()))}
    totals = (
        clean.assign(season_ord=clean["season"].map(order))
        .groupby(["season_ord", "name"], as_index=False)[CARRY_COLS]
        .sum()
    )
    frames = []
    for target in sorted(order.values()):
        past = totals[totals["season_ord"] < target]
        if past.empty:
            continue
        weight = 0.5 ** ((target - past["season_ord"]) / halflife)
        agg = past[CARRY_COLS].mul(weight, axis=0).groupby(past["name"].to_numpy()).sum()
        agg.index.name = "name"
        frames.append(agg.reset_index().assign(season_ord=target))
    if not frames:
        return pd.DataFrame(columns=["name", "season", *[f"carry_{c}" for c in CARRY_COLS]])
    carry = pd.concat(frames, ignore_index=True)
    inv = {v: k for k, v in order.items()}
    carry["season"] = carry["season_ord"].map(inv)
    return carry.drop(columns="season_ord").rename(
        columns={c: f"carry_{c}" for c in CARRY_COLS}
    )


def _player_features(df: pd.DataFrame, carry_halflife: float) -> pd.DataFrame:
    """As-of per-player rolling rates and recency features."""
    df = df.copy()
    df["played"] = (df["minutes"] > 0).astype(float)
    df["started"] = (df["starts"].fillna((df["minutes"] >= 60).astype(int)) == 1).astype(float)
    df["p60"] = (df["minutes"] >= 60).astype(float)
    df["xg"] = df["expected_goals"].fillna(0.0)
    df["xa"] = df["expected_assists"].fillna(0.0)
    df["saves"] = df["saves"].fillna(0.0)
    df["bps"] = df["bps"].fillna(0.0)

    # Prior-season evidence for the shrinkage stage, merged before grouping so
    # the row order the rolling features depend on is preserved.
    carry = career_carry_in(df, carry_halflife)
    df = df.merge(carry, on=["season", "name"], how="left")
    for col in CARRY_COLS:
        df[f"carry_{col}"] = df[f"carry_{col}"].fillna(0.0)

    g = df.groupby(["season", "element"], group_keys=False, sort=False)
    df["start_rate5"] = g["started"].apply(lambda s: _roll_shift(s, 5, "mean"))
    df["min_mean5"] = g["minutes"].apply(lambda s: _roll_shift(s, 5, "mean"))
    df["p60_rate5"] = g["p60"].apply(lambda s: _roll_shift(s, 5, "mean"))
    df["min_last1"] = g["minutes"].apply(lambda s: s.shift(1))
    df["played_last1"] = g["played"].apply(lambda s: s.shift(1))
    df["transfers_mom"] = g["transfers_balance"].apply(lambda s: s.shift(1))
    df["games_todate"] = g["played"].apply(lambda s: s.shift(1).expanding().sum())

    # As-of per-90 rates via cumulative sums (shifted), for shrinkage stages.
    # Season-scoped: the carry_* columns stay separate so the projection stage
    # can use them as a prior MEAN rather than as extra current-season sample.
    for col, out in [("xg", "cum_xg"), ("xa", "cum_xa"), ("minutes", "cum_min"),
                     ("bps", "cum_bps"), ("saves", "cum_saves")]:
        df[out] = g[col].apply(lambda s: s.shift(1).cumsum())

    df["days_since_last"] = g["kickoff_time"].apply(
        lambda s: (s - s.shift(1)).dt.total_seconds() / 86400.0
    )
    return df


def build_dataset(cfg: Config) -> pd.DataFrame:
    """Return the full modelling frame with as-of features and targets."""
    df = _load_fact(cfg)
    strength = _team_strength(df, cfg.raw["model"]["team_strength_halflife_matches"])
    df = df.merge(strength, on=["season", "fixture_id", "team_name"], how="left")

    # Opponent strength: join the opponent's row for the same fixture (season is
    # part of the key — fixture ids repeat across seasons).
    opp = strength.rename(
        columns={"team_name": "opponent_name", "att_ewma": "opp_att", "def_ewma": "opp_def"}
    )
    name_by = df.drop_duplicates(["season", "team_id"]).set_index(["season", "team_id"])[
        "team_name"
    ]
    df["opponent_name"] = df.set_index(["season", "opponent_team_id"]).index.map(name_by).to_numpy()
    df = df.merge(opp, on=["season", "fixture_id", "opponent_name"], how="left")

    df = _player_features(df, float(cfg.raw["model"]["career_prior_halflife_seasons"]))

    # Minutes-model target: 0 = DNP, 1 = 1-59, 2 = 60+.
    m = df["minutes"].to_numpy()
    df["minutes_class"] = np.where(m == 0, 0, np.where(m < 60, 1, 2))
    return df
