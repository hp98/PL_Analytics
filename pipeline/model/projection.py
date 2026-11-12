"""Stages 2-5 + assembly. Given an as-of feature frame with minutes
probabilities and team strengths, produce a point estimate xP per player-fixture.

    xP = appearance + attacking + clean-sheet + concede + bonus + peripherals

Attacking/defensive rates are empirical-Bayes shrunk toward positional priors
and adjusted by opponent strength and home/away. All stage outputs are already
weighted by the probability of playing (via expected minutes), so nothing is
double-counted.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import poisson

from pipeline.config import Config
from pipeline.model.scoring import (
    ASSIST_POINTS,
    CLEAN_SHEET_POINTS,
    DEFENSIVE_POSITIONS,
    GOAL_POINTS,
    SAVE_POINTS_PER,
)


@dataclass(frozen=True)
class Calibration:
    league_att: float           # league mean team xG (attack scale)
    promoted_att: float         # mean attack of a team in its first PL season
    promoted_def: float         # mean defence of a team in its first PL season
    lg_home_goals: float        # mean goals by the home team
    lg_away_goals: float        # mean goals by the away team
    prior_xg90: dict[str, float]
    prior_xa90: dict[str, float]
    prior_bps90: dict[str, float]
    prior_saves90: dict[str, float]


def _pos_prior(df: pd.DataFrame, num: str, minutes_ok: pd.Series) -> dict[str, float]:
    g = df[minutes_ok].groupby("position")
    rate = (g[num].sum() / g["minutes"].sum() * 90).to_dict()
    return {str(k): float(v) for k, v in rate.items()}


def calibrate(df: pd.DataFrame) -> Calibration:
    """League baselines + positional per-90 priors from the full frame.

    These are near-constant across seasons; using the full frame introduces only
    negligible look-ahead and keeps the priors stable for early-season shrinkage.
    """
    played = df["minutes"] > 0
    league_att = float(df["att_ewma"].dropna().mean())
    # Mean goals for the home vs away team, from one row per fixture.
    fixtures = df.drop_duplicates("fixture_id")
    lg_home = float(fixtures["team_h_score"].mean())
    lg_away = float(fixtures["team_a_score"].mean())
    # Newly-promoted teams have no Premier League history, so their strength
    # EWMAs are null. Falling back to the league mean modelled a promoted side as
    # an average top-flight team, which flattened every fixture against them.
    # Instead, fall back to how promoted teams actually perform: the mean
    # strength of teams observed in their FIRST season in the data. The earliest
    # season is excluded because every team looks new there.
    debut = df.groupby("team_name")["season"].min()
    earliest = df["season"].min()
    promoted_teams = debut[debut > earliest]
    is_debut = df["team_name"].map(debut).eq(df["season"]) & df["team_name"].isin(
        promoted_teams.index
    )
    promoted_att = float(df.loc[is_debut, "att_ewma"].dropna().mean())
    promoted_def = float(df.loc[is_debut, "def_ewma"].dropna().mean())
    league_def = float(df["def_ewma"].dropna().mean())
    if not np.isfinite(promoted_att):
        promoted_att = league_att
    if not np.isfinite(promoted_def):
        promoted_def = league_def

    df = df.assign(saves=df["saves"].fillna(0))
    return Calibration(
        league_att=league_att,
        promoted_att=promoted_att,
        promoted_def=promoted_def,
        lg_home_goals=lg_home,
        lg_away_goals=lg_away,
        prior_xg90=_pos_prior(df, "expected_goals", played & df["expected_goals"].notna()),
        prior_xa90=_pos_prior(df, "expected_assists", played & df["expected_assists"].notna()),
        prior_bps90=_pos_prior(df, "bps", played),
        prior_saves90=_pos_prior(df, "saves", played),
    )


def _shrunk_rate(
    cum_num: pd.Series, cum_min: pd.Series, prior: pd.Series, prior_matches: int
) -> pd.Series:
    """Empirical-Bayes: blend player per-90 with a positional prior by minutes."""
    player_rate = np.where(cum_min > 0, cum_num / cum_min.replace(0, np.nan) * 90, np.nan)
    player_rate = pd.Series(player_rate, index=cum_num.index).fillna(prior)
    w = cum_min / (cum_min + prior_matches * 90.0)
    return w * player_rate + (1 - w) * prior


def _carry(df: pd.DataFrame, col: str) -> pd.Series:
    """Career carry-in column, or zeros for frames built without the feature."""
    if col in df.columns:
        return df[col].fillna(0.0).astype(float)
    return pd.Series(0.0, index=df.index)


def _concede_penalty(lmbda: np.ndarray) -> np.ndarray:
    """E[-floor(X/2)] for X ~ Poisson(lambda), truncated at 10 goals."""
    ks = np.arange(0, 11)
    floor_half = np.floor(ks / 2)
    pmf = poisson.pmf(ks[None, :], lmbda[:, None])
    return np.asarray(-(pmf * floor_half[None, :]).sum(axis=1), dtype=float)


def project(df: pd.DataFrame, calib: Calibration, cfg: Config) -> pd.DataFrame:
    """Add an ``xp`` column (and its components) to the feature frame."""
    m = cfg.raw["model"]
    prior_matches = int(m["shrinkage_prior_matches"])
    cls = m["class_minutes"]
    home_adv = float(m["home_advantage"])
    temp = float(m["bonus_softmax_temperature"])

    pos = df["position"]

    # Two-stage (hierarchical) prior. Stage A shrinks a player's own decayed
    # career rate toward the positional average; stage B (below) shrinks their
    # season-to-date rate toward THAT rather than toward the position mean.
    #
    # Using the career rate as the prior MEAN -- rather than pooling career
    # minutes into the current-season sample -- leaves the weight on current
    # form unchanged, so early-season noise is not over-trusted, while an
    # established player still starts a season at their own level. Without it,
    # a GW3 projection put only 180/(180+900) = 17% weight on the player, so
    # Haaland was modelled at 0.32 xG90 against a stable career rate of ~0.75.
    def _prior(stat: str, pos_prior: dict[str, float]) -> pd.Series:
        base = pos.map(pos_prior).astype(float)
        return _shrunk_rate(
            _carry(df, f"carry_{stat}"), _carry(df, "carry_minutes"), base, prior_matches
        )

    prior_xg = _prior("xg", calib.prior_xg90)
    prior_xa = _prior("xa", calib.prior_xa90)
    prior_bps = _prior("bps", calib.prior_bps90)
    prior_saves = _prior("saves", calib.prior_saves90)

    xg90 = _shrunk_rate(df["cum_xg"], df["cum_min"], prior_xg, prior_matches)
    xa90 = _shrunk_rate(df["cum_xa"], df["cum_min"], prior_xa, prior_matches)
    bps90 = _shrunk_rate(df["cum_bps"], df["cum_min"], prior_bps, prior_matches)
    saves90 = _shrunk_rate(df["cum_saves"], df["cum_min"], prior_saves, prior_matches)

    # Expected minutes from the minutes-model scenario probabilities.
    exp_min = df["p_short"] * cls["short"] + df["p_long"] * cls["long"]
    minutes_frac = (exp_min / 90.0).clip(upper=1.0)

    # Opponent/home adjustments. Fall back to league-neutral when strength is NaN
    # (a team's first few matches ever).
    league_att = calib.league_att
    # A null strength means the team has no Premier League history, i.e. they
    # have just been promoted -- so use the typical promoted-team strength, not
    # the league average (see calibrate()).
    opp_def = df["opp_def"].fillna(calib.promoted_def)
    team_def = df["def_ewma"].fillna(calib.promoted_def)
    opp_att = df["opp_att"].fillna(calib.promoted_att)

    def_mult = (opp_def / league_att).clip(0.4, 2.5)  # leakier opponent -> easier
    home_scoring = np.where(df["was_home"], np.sqrt(home_adv), 1 / np.sqrt(home_adv))

    exp_goals = xg90 * minutes_frac * def_mult * home_scoring
    exp_assists = xa90 * minutes_frac * def_mult * home_scoring
    goal_pts = pos.map(GOAL_POINTS).fillna(0).astype(float)
    attack_pts = exp_goals * goal_pts + exp_assists * ASSIST_POINTS

    # Clean sheet / concede: team expected goals conceded.
    home = df["was_home"].to_numpy(dtype=bool)
    lg_conceded = np.where(home, calib.lg_away_goals, calib.lg_home_goals)
    lam_gc = (
        lg_conceded
        * (opp_att / league_att).clip(0.4, 2.5).to_numpy()
        * (team_def / league_att).clip(0.4, 2.5).to_numpy()
    )
    p_cs = np.exp(-lam_gc)
    cs_value = pos.map(CLEAN_SHEET_POINTS).fillna(0).astype(float).to_numpy()
    cs_pts = cs_value * p_cs * df["p_long"].to_numpy()

    is_def = pos.isin(DEFENSIVE_POSITIONS).to_numpy()
    concede_pts = np.where(is_def, _concede_penalty(lam_gc) * df["p_long"].to_numpy(), 0.0)

    # Bonus: soft within-fixture allocation of the 6 bonus points by expected BPS.
    exp_bps = (bps90 * minutes_frac).clip(lower=0).fillna(0)
    df_bps = pd.DataFrame({"fixture_id": df["fixture_id"], "e": exp_bps})
    ex = np.exp(df_bps["e"] / temp)
    share = ex / df_bps.groupby("fixture_id")["e"].transform(lambda s: np.exp(s / temp).sum())
    bonus_pts = (6.0 * share).clip(upper=3.0)

    # Peripherals.
    saves_pts = np.where(
        pos.to_numpy() == "GKP", (saves90 * minutes_frac / SAVE_POINTS_PER).to_numpy(), 0.0
    )
    p_play = (df["p_short"] + df["p_long"]).to_numpy()
    card_pts = -0.10 * p_play  # ~10% yellow-card rate per appearance

    appearance_pts = df["p_short"] * 1.0 + df["p_long"] * 2.0

    xp = (
        appearance_pts.to_numpy()
        + attack_pts.to_numpy()
        + cs_pts
        + concede_pts
        + bonus_pts.to_numpy()
        + saves_pts
        + card_pts
    )
    # Managers are not projected.
    xp = np.where(pos.to_numpy() == "MNG", 0.0, xp)

    out = df.copy()
    out["xp"] = xp
    out["xp_appearance"] = appearance_pts.to_numpy()
    out["xp_attack"] = attack_pts.to_numpy()
    out["xp_cs"] = cs_pts + concede_pts
    out["xp_bonus"] = bonus_pts.to_numpy()
    out["exp_goals"] = exp_goals.to_numpy()
    out["exp_assists"] = exp_assists.to_numpy()
    out["p_cs"] = p_cs
    out["exp_minutes"] = exp_min.to_numpy()
    return out
