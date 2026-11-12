"""Unit tests for the cross-season player-gameweek normalisation.

These use small synthetic frames to pin down the tricky schema-drift behaviour
(missing position/starts/xG, string booleans, the 2024-25 Assistant-Manager
asset). Synthetic data lives ONLY in tests — never in the pipeline itself.
"""

from __future__ import annotations

import polars as pl
import pytest

from pipeline.ingest.schema import (
    PLAYER_GW_SCHEMA,
    canonicalise_position,
    normalise_player_gameweek,
)


def _modern_row(**over: object) -> dict[str, object]:
    """A row shaped like a 2022-23+ merged_gw record (has position/starts/xG)."""
    base: dict[str, object] = {
        "element": 1,
        "name": "Test Player",
        "position": "MID",
        "team": "Arsenal",
        "GW": 5,
        "fixture": 42,
        "opponent_team": 7,
        "was_home": "True",
        "kickoff_time": "2023-09-01T14:00:00Z",
        "minutes": 90,
        "starts": 1,
        "total_points": 6,
        "goals_scored": 1,
        "assists": 0,
        "clean_sheets": 0,
        "goals_conceded": 1,
        "own_goals": 0,
        "penalties_saved": 0,
        "penalties_missed": 0,
        "yellow_cards": 0,
        "red_cards": 0,
        "saves": 0,
        "bonus": 2,
        "bps": 30,
        "influence": 40.2,
        "creativity": 12.5,
        "threat": 55.0,
        "ict_index": 10.8,
        "expected_goals": 0.42,
        "expected_assists": 0.11,
        "expected_goal_involvements": 0.53,
        "expected_goals_conceded": 1.2,
        "value": 75,
        "selected": 123456,
        "transfers_in": 1000,
        "transfers_out": 200,
        "transfers_balance": 800,
        "team_h_score": 2,
        "team_a_score": 1,
    }
    base.update(over)
    return base


def test_schema_shape_and_types() -> None:
    df = normalise_player_gameweek(pl.DataFrame([_modern_row()]), "2023-24")
    assert df.columns == list(PLAYER_GW_SCHEMA.keys())
    for col, dtype in PLAYER_GW_SCHEMA.items():
        assert df.schema[col] == dtype, f"{col}: {df.schema[col]} != {dtype}"
    assert df["season"][0] == "2023-24"


def test_string_boolean_parsed() -> None:
    home = normalise_player_gameweek(pl.DataFrame([_modern_row(was_home="True")]), "2023-24")
    away = normalise_player_gameweek(pl.DataFrame([_modern_row(was_home="False")]), "2023-24")
    assert home["was_home"][0] is True
    assert away["was_home"][0] is False


def test_was_started_derived_from_starts() -> None:
    started = normalise_player_gameweek(pl.DataFrame([_modern_row(starts=1)]), "2023-24")
    benched = normalise_player_gameweek(pl.DataFrame([_modern_row(starts=0)]), "2023-24")
    assert started["was_started"][0] is True
    assert benched["was_started"][0] is False


def test_old_season_missing_optionals_backfilled_null() -> None:
    """Pre-2022-23 rows lack starts + the xG family; they must become typed null."""
    row = _modern_row()
    for missing in ("starts", "expected_goals", "expected_assists",
                    "expected_goal_involvements", "expected_goals_conceded"):
        row.pop(missing)
    df = normalise_player_gameweek(pl.DataFrame([row]), "2020-21")
    assert df["starts"][0] is None
    assert df["was_started"][0] is None
    assert df["expected_goals"][0] is None


def test_position_backfilled_from_players_raw() -> None:
    """When merged_gw lacks `position`, it is derived from players_raw.element_type."""
    row = _modern_row()
    row.pop("position")
    players_raw = pl.DataFrame([{"id": 1, "element_type": 3}])  # 3 -> MID
    df = normalise_player_gameweek(pl.DataFrame([row]), "2016-17", players_raw)
    assert df["position"][0] == "MID"


def test_position_backfill_requires_players_raw() -> None:
    row = _modern_row()
    row.pop("position")
    with pytest.raises(ValueError, match="no position column"):
        normalise_player_gameweek(pl.DataFrame([row]), "2016-17", None)


def test_assistant_manager_maps_to_mng() -> None:
    """The 2024-25 Assistant-Manager asset (`AM`) is kept as MNG, not dropped."""
    df = normalise_player_gameweek(pl.DataFrame([_modern_row(position="AM")]), "2024-25")
    assert df["position"][0] == "MNG"


def test_missing_required_column_raises() -> None:
    row = _modern_row()
    row.pop("minutes")
    with pytest.raises(ValueError, match="missing required columns"):
        normalise_player_gameweek(pl.DataFrame([row]), "2023-24")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("GK", "GKP"), ("gkp", "GKP"), (" DEF ", "DEF"), ("FW", "FWD"),
     ("AM", "MNG"), ("unknown", None), (None, None)],
)
def test_canonicalise_position(raw: str | None, expected: str | None) -> None:
    assert canonicalise_position(raw) == expected
