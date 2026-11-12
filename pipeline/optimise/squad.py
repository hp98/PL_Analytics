"""Optimal-squad MIP (brief §7, modes 1 & 3).

Picks 15 players (2 GKP / 5 DEF / 5 MID / 3 FWD, max 3 per club, within budget),
a valid starting XI, and a captain, maximising projected points over the horizon
with a small reward for bench strength (auto-sub insurance).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pulp

SQUAD_SIZE = 15
XI_SIZE = 11
POSITION_QUOTA = {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}
# Valid starting-XI ranges per position (GK always exactly 1).
XI_MIN = {"GKP": 1, "DEF": 3, "MID": 2, "FWD": 1}
XI_MAX = {"GKP": 1, "DEF": 5, "MID": 5, "FWD": 3}
MAX_PER_CLUB = 3


@dataclass(frozen=True)
class SquadPick:
    element: int
    web_name: str
    position: str
    team: str
    price: float
    xp: float
    is_start: bool
    is_captain: bool


@dataclass(frozen=True)
class SquadSolution:
    picks: list[SquadPick]
    total_xp: float          # XI xp + captain bonus (+ bench reward)
    xi_xp: float             # starting XI projected points (captain doubled)
    cost: float
    status: str

    @property
    def bank(self) -> float:
        return round(100.0 - self.cost, 1)


def prune_candidates(df: pd.DataFrame, pool_size: int) -> pd.DataFrame:
    """Keep the top-N by xp within each position (so all quotas remain fillable)."""
    keep = []
    for pos, quota in POSITION_QUOTA.items():
        sub = df[df["position"] == pos].sort_values("xp", ascending=False)
        # Generous per-position slice; union is capped near pool_size overall.
        keep.append(sub.head(max(quota * 6, pool_size // 3)))
    pruned = pd.concat(keep).drop_duplicates("element").reset_index(drop=True)
    return pruned


def optimal_squad(
    df: pd.DataFrame,
    budget: float,
    bench_lambda: float,
    pool_size: int = 250,
    time_limit_s: int = 20,
) -> SquadSolution:
    """Solve for the best 15 + XI + captain within ``budget`` (£m)."""
    cand = prune_candidates(df, pool_size)
    n = len(cand)
    idx = range(n)
    xp = cand["xp"].to_numpy()
    price = cand["price"].to_numpy()
    pos = cand["position"].to_list()
    team = cand["team"].to_list()

    prob = pulp.LpProblem("optimal_squad", pulp.LpMaximize)
    pick = pulp.LpVariable.dicts("pick", idx, cat="Binary")
    start = pulp.LpVariable.dicts("start", idx, cat="Binary")
    cap = pulp.LpVariable.dicts("cap", idx, cat="Binary")

    # Objective: XI points + captain bonus + small bench reward.
    prob += (
        pulp.lpSum(xp[i] * start[i] for i in idx)
        + pulp.lpSum(xp[i] * cap[i] for i in idx)
        + bench_lambda * pulp.lpSum(xp[i] * (pick[i] - start[i]) for i in idx)
    )

    prob += pulp.lpSum(pick[i] for i in idx) == SQUAD_SIZE
    prob += pulp.lpSum(start[i] for i in idx) == XI_SIZE
    prob += pulp.lpSum(cap[i] for i in idx) == 1
    prob += pulp.lpSum(price[i] * pick[i] for i in idx) <= budget

    for i in idx:
        prob += start[i] <= pick[i]
        prob += cap[i] <= start[i]

    for p, quota in POSITION_QUOTA.items():
        members = [i for i in idx if pos[i] == p]
        prob += pulp.lpSum(pick[i] for i in members) == quota
        prob += pulp.lpSum(start[i] for i in members) >= XI_MIN[p]
        prob += pulp.lpSum(start[i] for i in members) <= XI_MAX[p]

    for club in set(team):
        members = [i for i in idx if team[i] == club]
        prob += pulp.lpSum(pick[i] for i in members) <= MAX_PER_CLUB

    prob.solve(pulp.PULP_CBC_CMD(msg=False, timeLimit=time_limit_s))

    picks: list[SquadPick] = []
    for i in idx:
        if pick[i].value() and pick[i].value() > 0.5:
            picks.append(
                SquadPick(
                    element=int(cand.iloc[i]["element"]),
                    web_name=str(cand.iloc[i]["web_name"]),
                    position=pos[i],
                    team=team[i],
                    price=float(price[i]),
                    xp=float(xp[i]),
                    is_start=bool(start[i].value() and start[i].value() > 0.5),
                    is_captain=bool(cap[i].value() and cap[i].value() > 0.5),
                )
            )
    xi_xp = sum(p.xp * (2 if p.is_captain else 1) for p in picks if p.is_start)
    return SquadSolution(
        picks=picks,
        total_xp=round(float(pulp.value(prob.objective) or 0.0), 2),
        xi_xp=round(xi_xp, 2),
        cost=round(sum(p.price for p in picks), 1),
        status=pulp.LpStatus[prob.status],
    )
