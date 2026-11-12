"""Build the optimiser candidate pool from model projections + live prices."""

from __future__ import annotations

from typing import Any

import pandas as pd

_POSITION_BY_TYPE = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def build_candidates(
    proj: pd.DataFrame, bootstrap: dict[str, Any], horizon_gws: list[int]
) -> pd.DataFrame:
    """One row per eligible player: current price/position/team + horizon xp.

    Horizon xp sums projected points over the given gameweeks (double gameweeks
    counted naturally, since a DGW contributes two rows).
    """
    horizon = proj[proj["gw"].isin(horizon_gws)]
    xp = horizon.groupby("element", as_index=False)["xp"].sum()

    teams = {t["id"]: t["short_name"] for t in bootstrap["teams"]}
    meta = []
    for e in bootstrap["elements"]:
        pos = _POSITION_BY_TYPE.get(e["element_type"])
        if pos is None:  # managers
            continue
        meta.append(
            {
                "element": e["id"],
                "web_name": e["web_name"],
                "position": pos,
                "team": teams.get(e["team"], "?"),
                "price": e["now_cost"] / 10.0,
                "status": e.get("status", "a"),
            }
        )
    meta_df = pd.DataFrame(meta)
    cand = meta_df.merge(xp, on="element", how="left")
    cand["xp"] = cand["xp"].fillna(0.0)
    # Exclude unavailable players (injured/suspended long-term) from the pool.
    cand = cand[cand["status"].isin(["a", "d"])].reset_index(drop=True)
    return cand
