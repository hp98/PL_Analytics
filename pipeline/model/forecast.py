"""Live forward projections for upcoming gameweeks.

Uses the validated model (minutes classifier + statistical stages) with each
player's current-season as-of state and the live FPL fixture list. Adds a
Monte-Carlo 10th/90th band and folds in live injury availability
(`chance_of_playing_next_round`). Early in a season these lean heavily on
positional priors — that is honest, not a bug: little form has accrued yet.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from pipeline.config import Config
from pipeline.model.dataset import build_dataset, career_carry_in, current_team_strength
from pipeline.model.minutes import predict_minutes, train_minutes_model
from pipeline.model.projection import Calibration, calibrate, project
from pipeline.model.scoring import CLEAN_SHEET_POINTS, GOAL_POINTS
from pipeline.publish import upcoming_gameweeks

_POSITION_BY_TYPE = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

def _num(value: Any, default: float = 0.0) -> float:
    """float() that tolerates None / NaN / pandas NA.

    Rows topped up from the FPL API leave a few columns null (per-gameweek
    transfer counts and ownership aren't exposed by `event/{gw}/live/`), so the
    feature builder must not assume every field is populated.
    """
    if value is None or value is pd.NA:
        return default
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(out) else out


def _current_player_state(df: pd.DataFrame, season: str, carry_halflife: float) -> pd.DataFrame:
    """As-of cumulative + recent-form features per element for the live season.

    Cumulative rate inputs carry decayed prior-season totals (see
    ``career_carry_in``); the rotation/form features stay season-scoped, because
    they describe how a player is being used right now.
    """
    cur = df[df["season"] == season].sort_values("kickoff_time")
    agg = cur.groupby("element").agg(
        cum_xg=("expected_goals", lambda s: float(s.fillna(0).sum())),
        cum_xa=("expected_assists", lambda s: float(s.fillna(0).sum())),
        cum_min=("minutes", "sum"),
        cum_bps=("bps", "sum"),
        cum_saves=("saves", lambda s: float(s.fillna(0).sum())),
        games_todate=("minutes", lambda s: float((s > 0).sum())),
        min_last1=("minutes", "last"),
        last_kickoff=("kickoff_time", "max"),
        transfers_mom=("transfers_balance", "last"),
    )

    def _form(g: pd.DataFrame) -> pd.Series:
        t = g.tail(5)
        started = (t["starts"].fillna((t["minutes"] >= 60).astype(int)) == 1).mean()
        return pd.Series(
            {
                "start_rate5": float(started),
                "min_mean5": float(t["minutes"].mean()),
                "p60_rate5": float((t["minutes"] >= 60).mean()),
                "played_last1": float(g["minutes"].iloc[-1] > 0),
            }
        )

    form = cur.groupby("element").apply(_form, include_groups=False)
    out = agg.join(form).reset_index()

    # Blend in prior seasons so an established player is not shrunk onto the
    # positional mean for the opening weeks of a campaign.
    carry = career_carry_in(
        df.assign(xg=df["expected_goals"], xa=df["expected_assists"]), carry_halflife
    )
    carry = carry[carry["season"] == season]
    pairs = [
        ("cum_xg", "carry_xg"), ("cum_xa", "carry_xa"), ("cum_min", "carry_minutes"),
        ("cum_bps", "carry_bps"), ("cum_saves", "carry_saves"),
    ]
    cols = [c for _, c in pairs]
    # Carry is keyed on name (element ids are recycled between seasons), so map
    # this season's elements to their names to join.
    names = cur.groupby("element")["name"].last().rename("name")
    out = out.merge(names, on="element", how="left").merge(
        carry[["name", *cols]], on="name", how="left"
    )
    for _, car in pairs:
        out[car] = out[car].fillna(0.0)
    return out.drop(columns=["name"])


def _upcoming(
    bootstrap: dict[str, Any], fixtures: list[dict[str, Any]], horizon: int
) -> tuple[pd.DataFrame, list[int]]:
    """Upcoming fixtures (next `horizon` unfinished GWs) as team-fixture rows."""
    team_name = {t["id"]: t["name"] for t in bootstrap["teams"]}
    # Same definition as the ticker: gameweeks whose deadline is still ahead.
    # Projecting a gameweek you can no longer pick for is wasted work.
    gws = upcoming_gameweeks(bootstrap, horizon)
    gwset = set(gws)
    rows = []
    for fx in fixtures:
        gw = fx.get("event")
        if gw not in gwset or fx["team_h"] not in team_name or fx["team_a"] not in team_name:
            continue
        sides = ((fx["team_h"], fx["team_a"], True), (fx["team_a"], fx["team_h"], False))
        for tid, opp, home in sides:
            rows.append(
                {
                    "gw": gw,
                    "fixture_id": fx["id"],
                    "team_id": tid,
                    "team_name": team_name[tid],
                    "opponent_name": team_name[opp],
                    "was_home": home,
                    "kickoff_time": fx.get("kickoff_time"),
                }
            )
    return pd.DataFrame(rows), gws


def _availability(element: dict[str, Any]) -> float:
    """Live play-availability multiplier from status / chance_of_playing."""
    cop = element.get("chance_of_playing_next_round")
    if cop is not None:
        return float(cop) / 100.0
    return 0.0 if element.get("status") in {"i", "s", "u", "n"} else 1.0


def build_forecast_frame(
    cfg: Config, bootstrap: dict[str, Any], fixtures: list[dict[str, Any]]
) -> tuple[pd.DataFrame, list[int], Calibration]:
    """Assemble the player x upcoming-fixture frame with as-of features."""
    df = build_dataset(cfg)
    calib = calibrate(df)
    model = train_minutes_model(df)

    state = _current_player_state(
        df, cfg.current_season, float(cfg.raw["model"]["career_prior_halflife_seasons"])
    ).set_index("element")
    strength = current_team_strength(df, cfg.raw["model"]["team_strength_halflife_matches"])
    att = dict(zip(strength["team_name"], strength["att_now"], strict=True))
    dfn = dict(zip(strength["team_name"], strength["def_now"], strict=True))

    team_of = {t["id"]: t["name"] for t in bootstrap["teams"]}
    upcoming, gws = _upcoming(bootstrap, fixtures, cfg.publish.ticker_horizon_gws)
    upcoming = upcoming.set_index(["team_id", "gw"])

    rows: list[dict[str, Any]] = []
    for el in bootstrap["elements"]:
        pos = _POSITION_BY_TYPE.get(el["element_type"])
        if pos is None:  # skip managers
            continue
        tname = team_of.get(el["team"])
        st = state.loc[el["id"]] if el["id"] in state.index else None
        avail = _availability(el)
        for gw in gws:
            key = (el["team"], gw)
            if key not in upcoming.index:
                continue
            fixtures_gw = upcoming.loc[[key]]
            for _, fx in fixtures_gw.iterrows():
                last_kick = st["last_kickoff"] if st is not None else pd.NaT
                kick = (
                    pd.to_datetime(fx["kickoff_time"], utc=True) if fx["kickoff_time"] else pd.NaT
                )
                if pd.notna(last_kick) and pd.notna(kick):
                    days = (kick - last_kick).total_seconds() / 86400.0
                else:
                    days = 7.0
                rows.append(
                    {
                        "element": el["id"],
                        "web_name": el["web_name"],
                        "gw": gw,
                        "fixture_id": int(fx["fixture_id"]),
                        "position": pos,
                        "team_name": tname,
                        "opponent_name": fx["opponent_name"],
                        "was_home": bool(fx["was_home"]),
                        "value": float(el["now_cost"]),
                        "availability": avail,
                        "cum_xg": _num(st["cum_xg"], 0.0) if st is not None else 0.0,
                        "cum_xa": _num(st["cum_xa"], 0.0) if st is not None else 0.0,
                        "cum_min": _num(st["cum_min"], 0.0) if st is not None else 0.0,
                        "cum_bps": _num(st["cum_bps"], 0.0) if st is not None else 0.0,
                        "cum_saves": _num(st["cum_saves"], 0.0) if st is not None else 0.0,
                        # Decayed prior-season totals feeding the two-stage
                        # prior. Omitting these silently reverts the live model
                        # to the positional prior for every player.
                        "carry_xg": _num(st["carry_xg"], 0.0) if st is not None else 0.0,
                        "carry_xa": _num(st["carry_xa"], 0.0) if st is not None else 0.0,
                        "carry_minutes": _num(st["carry_minutes"], 0.0) if st is not None else 0.0,
                        "carry_bps": _num(st["carry_bps"], 0.0) if st is not None else 0.0,
                        "carry_saves": _num(st["carry_saves"], 0.0) if st is not None else 0.0,
                        "games_todate": _num(st["games_todate"], 0.0) if st is not None else 0.0,
                        "min_last1": (
                            _num(st["min_last1"], np.nan) if st is not None else np.nan
                        ),
                        "played_last1": (
                            _num(st["played_last1"], np.nan) if st is not None else np.nan
                        ),
                        "start_rate5": (
                            _num(st["start_rate5"], np.nan) if st is not None else np.nan
                        ),
                        "min_mean5": _num(st["min_mean5"], np.nan) if st is not None else np.nan,
                        "p60_rate5": _num(st["p60_rate5"], np.nan) if st is not None else np.nan,
                        "transfers_mom": _num(st["transfers_mom"], 0.0) if st is not None else 0.0,
                        "days_since_last": days,
                        # Missing strength means no Premier League history, i.e.
                        # a promoted team. Leave it null so the projection stage
                        # substitutes the promoted-team baseline; defaulting to
                        # the league mean here would model Coventry as average.
                        "att_ewma": att.get(tname, np.nan),
                        "def_ewma": dfn.get(tname, np.nan),
                        "opp_att": att.get(fx["opponent_name"], np.nan),
                        "opp_def": dfn.get(fx["opponent_name"], np.nan),
                    }
                )

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame, gws, calib

    mins = predict_minutes(model, frame)
    frame = pd.concat([frame, mins], axis=1)
    # Fold live availability into the minutes probabilities.
    avail = frame["availability"].to_numpy()
    lost = (frame["p_short"] + frame["p_long"]).to_numpy() * (1 - avail)
    frame["p_short"] = frame["p_short"] * avail
    frame["p_long"] = frame["p_long"] * avail
    frame["p_dnp"] = frame["p_dnp"] + lost
    return frame, gws, calib


def _monte_carlo(proj: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """10th/90th percentile band per player-fixture, centred on xp."""
    sims = int(cfg.raw["model"]["monte_carlo_sims"])
    rng = np.random.default_rng(42)
    n = len(proj)
    pos = proj["position"].to_numpy()
    goal_pts = np.array([GOAL_POINTS.get(p, 0) for p in pos], dtype=float)
    cs_val = np.array([CLEAN_SHEET_POINTS.get(p, 0) for p in pos], dtype=float)

    eg = proj["exp_goals"].to_numpy()
    ea = proj["exp_assists"].to_numpy()
    p_cs = proj["p_cs"].to_numpy()
    p_dnp = proj["p_dnp"].to_numpy()
    p_short = proj["p_short"].to_numpy()
    p_long = proj["p_long"].to_numpy()
    xp = proj["xp"].to_numpy()

    # Simulate appearance (0/1/2), goals, assists, clean sheet (only if 60+).
    u = rng.random((n, sims))
    appearance = np.where(u < p_dnp[:, None], 0, np.where(u < (p_dnp + p_short)[:, None], 1, 2))
    goals = rng.poisson(np.clip(eg, 0, None)[:, None], size=(n, sims))
    assists = rng.poisson(np.clip(ea, 0, None)[:, None], size=(n, sims))
    cs = (appearance == 2) & (rng.random((n, sims)) < p_cs[:, None])
    stoch = appearance + goals * goal_pts[:, None] + assists * 3 + cs * cs_val[:, None]

    e_stoch = (
        (p_short + 2 * p_long)
        + eg * goal_pts
        + ea * 3
        + p_cs * p_long * cs_val
    )
    deterministic = (xp - e_stoch)[:, None]
    points = stoch + deterministic
    out = proj.copy()
    out["xp_low"] = np.percentile(points, 10, axis=1)
    out["xp_high"] = np.percentile(points, 90, axis=1)
    # Haul / return probabilities drive the captaincy view (§8.6).
    out["p_haul"] = (points >= 10).mean(axis=1)   # P(returns >= 10)
    out["p_return"] = (points >= 5).mean(axis=1)   # P(a "return", >= 5)
    return out


def run_forecast(
    cfg: Config, bootstrap: dict[str, Any], fixtures: list[dict[str, Any]]
) -> tuple[pd.DataFrame, list[int]]:
    """Return per (element, gw) projections with xp + MC band."""
    frame, gws, calib = build_forecast_frame(cfg, bootstrap, fixtures)
    if frame.empty:
        return frame, gws
    proj = project(frame, calib, cfg)
    proj = _monte_carlo(proj, cfg)
    proj["xp"] = proj["xp"].clip(lower=0)
    return proj, gws


def summarise_projections(proj: pd.DataFrame, gws: list[int]) -> dict[str, Any]:
    """Per-element projection bundle for the frontend (double gameweeks summed)."""
    if proj.empty:
        return {"horizon": gws, "players": {}}
    agg = (
        proj.groupby(["element", "gw"])
        .agg(
            xp=("xp", "sum"),
            low=("xp_low", "sum"),
            high=("xp_high", "sum"),
            web_name=("web_name", "first"),
            position=("position", "first"),
            opp=("opponent_name", lambda s: "+".join(s)),
            home=("was_home", "first"),
            app=("xp_appearance", "sum"),
            atk=("xp_attack", "sum"),
            cs=("xp_cs", "sum"),
            bon=("xp_bonus", "sum"),
            p_haul=("p_haul", "max"),
            p_return=("p_return", "max"),
        )
        .reset_index()
    )
    next_gw = gws[0]
    next5 = set(gws[:5])
    players: dict[str, Any] = {}
    for element, sub in agg.groupby("element"):
        sub = sub.sort_values("gw")
        nrow = sub[sub["gw"] == next_gw]
        first = sub.iloc[0]
        next_block = None
        if not nrow.empty:
            r = nrow.iloc[0]
            next_block = {
                "gw": int(next_gw),
                "xp": round(float(r["xp"]), 2),
                "low": round(float(r["low"]), 1),
                "high": round(float(r["high"]), 1),
                "opp": r["opp"],
                "home": bool(r["home"]),
                "p_haul": round(float(r["p_haul"]), 3),
                "p_return": round(float(r["p_return"]), 3),
                "components": {
                    "app": round(float(r["app"]), 2),
                    "atk": round(float(r["atk"]), 2),
                    "cs": round(float(r["cs"]), 2),
                    "bon": round(float(r["bon"]), 2),
                },
            }
        players[str(int(element))] = {
            "web_name": first["web_name"],
            "position": first["position"],
            "next_gw": next_block,
            "next5_xp": round(float(sub[sub["gw"].isin(next5)]["xp"].sum()), 2),
            "per_gw": [
                {
                    "gw": int(r["gw"]),
                    "xp": round(float(r["xp"]), 2),
                    "opp": r["opp"],
                    "home": bool(r["home"]),
                }
                for _, r in sub.iterrows()
            ],
        }
    return {"horizon": gws, "players": players}
