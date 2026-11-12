"""Unit tests for the projection-model stages (§12: pytest per stage).

Synthetic frames only — no warehouse dependency. These pin the leakage-safe
shift semantics, the shrinkage blend, the Poisson concede penalty, minutes
normalisation, assembly bounds, and the backtest metric helper.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.config import load_config
from pipeline.model.baselines import add_baselines
from pipeline.model.dataset import _roll_shift
from pipeline.model.minutes import predict_minutes, train_minutes_model
from pipeline.model.projection import (
    _concede_penalty,
    _shrunk_rate,
    calibrate,
    project,
)


def test_roll_shift_excludes_current_row() -> None:
    s = pd.Series([1.0, 2.0, 3.0, 4.0])
    # rolling mean of prior rows only: [nan, 1, 1.5, 2.5]
    out = _roll_shift(s, 2, "mean").to_numpy()
    assert np.isnan(out[0])
    assert out[1] == pytest.approx(1.0)
    assert out[2] == pytest.approx(1.5)
    assert out[3] == pytest.approx(2.5)


def test_shrunk_rate_blends_toward_prior() -> None:
    prior = pd.Series([0.5, 0.5])
    # No minutes yet -> falls fully back to the prior.
    cold = _shrunk_rate(pd.Series([0.0, 0.0]), pd.Series([0.0, 0.0]), prior, 10)
    assert cold.to_numpy() == pytest.approx([0.5, 0.5])
    # Large minutes sample -> pulled toward the player's own rate, away from prior.
    hot = _shrunk_rate(pd.Series([20.0, 20.0]), pd.Series([9000.0, 9000.0]), prior, 10)
    player_rate = 20.0 / 9000.0 * 90  # 0.2
    assert abs(hot.iloc[0] - player_rate) < abs(hot.iloc[0] - 0.5)
    assert player_rate < hot.iloc[0] < 0.5


def test_concede_penalty_is_negative_and_monotonic() -> None:
    p = _concede_penalty(np.array([0.0, 1.0, 2.0, 4.0]))
    assert p[0] == pytest.approx(0.0, abs=1e-9)
    assert p[1] < 0 and p[2] < p[1] and p[3] < p[2]
    # Reference check at lambda=2: E[floor(X/2)] computed independently.
    from scipy.stats import poisson

    ks = np.arange(0, 30)
    ref = -(poisson.pmf(ks, 2.0) * np.floor(ks / 2)).sum()
    assert p[2] == pytest.approx(ref, abs=1e-3)


def _synthetic_frame() -> pd.DataFrame:
    rows = []
    for i, (pos, xg, played_min) in enumerate(
        [("FWD", 0.6, 90), ("MID", 0.3, 90), ("DEF", 0.05, 90), ("GKP", 0.0, 90), ("MNG", 0.0, 0)]
    ):
        rows.append(
            {
                "fixture_id": 1,
                "season": "2024-25",
                "team_name": "Team A",
                "position": pos,
                "was_home": True,
                "minutes": played_min,
                "expected_goals": xg,
                "expected_assists": 0.1,
                "bps": 25,
                "saves": 3 if pos == "GKP" else 0,
                "team_h_score": 2,
                "team_a_score": 1,
                "att_ewma": 1.5,
                "def_ewma": 1.1,
                "opp_att": 1.2,
                "opp_def": 1.3,
                "cum_xg": xg * 10,
                "cum_xa": 1.0,
                "cum_min": 900.0,
                "cum_bps": 250.0,
                "cum_saves": 30.0 if pos == "GKP" else 0.0,
                "carry_xg": 0.0,
                "carry_xa": 0.0,
                "carry_minutes": 0.0,
                "carry_bps": 0.0,
                "carry_saves": 0.0,
                "p_dnp": 0.1,
                "p_short": 0.1,
                "p_long": 0.8,
            }
        )
        _ = i
    return pd.DataFrame(rows)


def test_project_produces_bounded_xp_and_zero_for_manager() -> None:
    cfg = load_config()
    df = _synthetic_frame()
    calib = calibrate(df)
    out = project(df, calib, cfg)
    xp = out.set_index("position")["xp"]
    assert xp.notna().all()
    assert (xp >= 0).all() and (xp <= 25).all()
    assert xp["MNG"] == pytest.approx(0.0)
    # The attacking component must respond to xG: a prolific forward's attacking
    # points exceed a low-threat defender's (total xp can differ because the
    # defender also earns clean-sheet points).
    attack = out.set_index("position")["xp_attack"]
    assert attack["FWD"] > attack["DEF"]


def test_career_carry_lifts_an_established_player_off_the_positional_prior() -> None:
    """Two matches of form must not flatten a proven scorer onto the FWD mean.

    Regression for the defect that projected Haaland at 0.32 xG90 in GW3 against
    a stable four-season rate of ~0.75, because cumulative rates reset at every
    season boundary and 83% of the weight fell on the positional prior.
    """
    cfg = load_config()
    calib = calibrate(_synthetic_frame())
    # An elite scorer, but ordinary for assists/bonus so only xG differs.
    xg_rate = calib.prior_xg90["FWD"] * 2.5
    xa_rate = calib.prior_xa90["FWD"]
    bps_rate = calib.prior_bps90["FWD"]

    def frame(carry_minutes: float) -> pd.DataFrame:
        df = _synthetic_frame()
        df["cum_min"] = 180.0  # two matches into a season
        df["cum_xg"] = xg_rate / 90.0 * 180.0
        df["cum_xa"] = xa_rate / 90.0 * 180.0
        df["cum_bps"] = bps_rate / 90.0 * 180.0
        # Carry is a whole career, so every stat scales with it together.
        df["carry_minutes"] = carry_minutes
        df["carry_xg"] = xg_rate / 90.0 * carry_minutes
        df["carry_xa"] = xa_rate / 90.0 * carry_minutes
        df["carry_bps"] = bps_rate / 90.0 * carry_minutes
        return df

    without = project(frame(0.0), calib, cfg).set_index("position")["xp_attack"]
    with_carry = project(frame(4000.0), calib, cfg).set_index("position")["xp_attack"]
    assert with_carry["FWD"] > without["FWD"]

    # And the carried projection should sit near the player's real rate rather
    # than being dragged most of the way back to the positional average.
    assert with_carry["FWD"] > without["FWD"] * 1.5


def test_promoted_teams_are_calibrated_weaker_than_the_league() -> None:
    """A newly promoted side must not fall back to league-average strength.

    Coventry/Ipswich/Hull have no Premier League history, so their strength EWMAs
    are null; using the league mean modelled them as an average top-flight team.
    """
    rows = []
    for season, teams in [("2023-24", ["A", "B"]), ("2024-25", ["A", "B", "Promoted"])]:
        for team in teams:
            debut = team == "Promoted"
            rows.append(
                {
                    "season": season,
                    "team_name": team,
                    "fixture_id": len(rows) + 1,
                    "position": "FWD",
                    "minutes": 90,
                    "expected_goals": 0.3,
                    "expected_assists": 0.1,
                    "bps": 20,
                    "saves": 0,
                    "team_h_score": 1,
                    "team_a_score": 1,
                    # The promoted side scores less and concedes more.
                    "att_ewma": 0.7 if debut else 1.5,
                    "def_ewma": 1.9 if debut else 1.1,
                }
            )
    calib = calibrate(pd.DataFrame(rows))
    assert calib.promoted_att < calib.league_att   # blunter attack
    assert calib.promoted_def > 1.1                # leakier defence than an established side


def test_predict_minutes_rows_sum_to_one() -> None:
    # Tiny synthetic training set spanning the three minutes classes.
    rng = np.random.default_rng(0)
    n = 300
    train = pd.DataFrame(
        {
            "start_rate5": rng.random(n),
            "min_mean5": rng.random(n) * 90,
            "p60_rate5": rng.random(n),
            "min_last1": rng.random(n) * 90,
            "played_last1": rng.integers(0, 2, n).astype(float),
            "transfers_mom": rng.normal(0, 1000, n),
            "games_todate": rng.integers(0, 20, n).astype(float),
            "days_since_last": rng.random(n) * 10,
            "value": rng.integers(40, 130, n).astype(float),
            "position": rng.choice(["GKP", "DEF", "MID", "FWD"], n),
            "minutes_class": rng.integers(0, 3, n),
        }
    )
    model = train_minutes_model(train, seed=0)
    probs = predict_minutes(model, train.head(10))
    totals = probs[["p_dnp", "p_short", "p_long"]].sum(axis=1)
    assert np.allclose(totals.to_numpy(), 1.0, atol=1e-9)


def test_add_baselines_are_as_of() -> None:
    df = pd.DataFrame(
        {
            "season": ["2024-25"] * 4,
            "element": [1, 1, 1, 1],
            "gw": [1, 2, 3, 4],
            "fixture_id": [1, 2, 3, 4],
            "kickoff_time": pd.to_datetime(
                ["2024-08-10", "2024-08-17", "2024-08-24", "2024-08-31"], utc=True
            ),
            "total_points": [2.0, 6.0, 10.0, 4.0],
        }
    )
    out = add_baselines(df).sort_values("gw")
    # season_ppg at gw3 must use only gw1+gw2 = (2+6)/2 = 4.
    assert out.iloc[2]["season_ppg"] == pytest.approx(4.0)
    # First match has no history -> filled to 0.
    assert out.iloc[0]["season_ppg"] == pytest.approx(0.0)
