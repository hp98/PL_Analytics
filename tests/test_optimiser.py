"""Optimiser constraint tests (§12: pytest for the optimiser constraints).

Proves the MIP respects every FPL squad rule on a synthetic candidate pool.
"""

from __future__ import annotations

import pandas as pd
import pytest

from pipeline.optimise.squad import (
    MAX_PER_CLUB,
    POSITION_QUOTA,
    SQUAD_SIZE,
    XI_MAX,
    XI_MIN,
    XI_SIZE,
    optimal_squad,
)


def _candidate_pool() -> pd.DataFrame:
    rng = 0
    rows = []
    eid = 0
    clubs = [f"C{c}" for c in range(8)]
    # Plenty per position across many clubs so quotas + 3-per-club are feasible.
    per_pos = {"GKP": 12, "DEF": 30, "MID": 30, "FWD": 18}
    for pos, count in per_pos.items():
        for j in range(count):
            eid += 1
            rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF
            price = 4.0 + (rng % 90) / 10.0  # 4.0 - 12.9
            rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF
            xp = 1.0 + (rng % 800) / 100.0  # 1.0 - 9.0
            rows.append(
                {
                    "element": eid,
                    "web_name": f"{pos}{j}",
                    "position": pos,
                    "team": clubs[j % len(clubs)],
                    "price": round(price, 1),
                    "xp": round(xp, 2),
                }
            )
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def solution():
    return optimal_squad(_candidate_pool(), budget=100.0, bench_lambda=0.1)


def test_status_optimal(solution) -> None:
    assert solution.status == "Optimal"


def test_squad_size_and_position_quotas(solution) -> None:
    assert len(solution.picks) == SQUAD_SIZE
    for pos, quota in POSITION_QUOTA.items():
        assert sum(1 for p in solution.picks if p.position == pos) == quota


def test_starting_xi_is_a_valid_formation(solution) -> None:
    starters = [p for p in solution.picks if p.is_start]
    assert len(starters) == XI_SIZE
    for pos in POSITION_QUOTA:
        c = sum(1 for p in starters if p.position == pos)
        assert XI_MIN[pos] <= c <= XI_MAX[pos]


def test_exactly_one_captain_who_starts(solution) -> None:
    caps = [p for p in solution.picks if p.is_captain]
    assert len(caps) == 1
    assert caps[0].is_start


def test_max_three_per_club(solution) -> None:
    counts: dict[str, int] = {}
    for p in solution.picks:
        counts[p.team] = counts.get(p.team, 0) + 1
    assert all(c <= MAX_PER_CLUB for c in counts.values())


def test_within_budget(solution) -> None:
    assert solution.cost <= 100.0
    assert solution.bank == round(100.0 - solution.cost, 1)


def test_prefers_higher_xp_when_feasible() -> None:
    # A cheap, high-xp player should always be selected over a cheap low-xp one.
    df = _candidate_pool()
    df.loc[df.index[0], ["price", "xp", "position", "web_name"]] = [4.0, 50.0, "MID", "STAR"]
    sol = optimal_squad(df, budget=100.0, bench_lambda=0.1)
    assert any(p.web_name == "STAR" and p.is_start and p.is_captain for p in sol.picks)
