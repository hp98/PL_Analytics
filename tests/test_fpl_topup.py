"""The FPL API top-up must carry ownership, transfers and the price at the time.

The live endpoint has match stats only. Without the per-player history overlay
the top-up left ``selected``/transfers null and stamped today's price on past
fixtures: the Explorer's "Selected" showed "--" for everyone and season
transfers-in silently omitted every topped-up gameweek.
"""

from __future__ import annotations

import polars as pl

from pipeline.ingest.fpl_gameweeks import _apply_history


def _topup_rows() -> pl.DataFrame:
    # Shaped like the live-feed rows: today's price, no ownership/transfers.
    return pl.DataFrame(
        {
            "element": [430, 430, 7],
            "fixture": [66, 79, 66],
            "total_points": [5, 2, 1],
            "value": [60, 60, 45],
            "selected": [None, None, None],
            "transfers_in": [None, None, None],
            "transfers_out": [None, None, None],
            "transfers_balance": [None, None, None],
        },
        schema_overrides={
            "selected": pl.Int64,
            "transfers_in": pl.Int64,
            "transfers_out": pl.Int64,
            "transfers_balance": pl.Int64,
        },
    )


HIST = {
    (430, 66): {"value": 54, "selected": 3802, "transfers_in": 125,
                "transfers_out": 252, "transfers_balance": -127},
    (430, 79): {"value": 54, "selected": 3953, "transfers_in": 150,
                "transfers_out": 171, "transfers_balance": -21},
}


def test_history_fills_ownership_transfers_and_historical_price() -> None:
    out = _apply_history(_topup_rows(), HIST).filter(pl.col("element") == 430).sort("fixture")
    assert out["selected"].to_list() == [3802, 3953]
    assert out["transfers_in"].to_list() == [125, 150]
    assert out["transfers_balance"].to_list() == [-127, -21]
    # The price at that fixture, not today's 60.
    assert out["value"].to_list() == [54, 54]


def test_player_without_history_keeps_live_values() -> None:
    out = _apply_history(_topup_rows(), HIST).filter(pl.col("element") == 7)
    assert out["value"].to_list() == [45]          # live fallback retained
    assert out["selected"].to_list() == [None]      # unknown stays unknown, never invented


def test_overlay_preserves_rows_columns_and_order() -> None:
    before = _topup_rows()
    out = _apply_history(before, HIST)
    assert out.columns == before.columns
    assert out.height == before.height
    assert out["total_points"].to_list() == before["total_points"].to_list()


def test_empty_history_is_a_no_op() -> None:
    before = _topup_rows()
    assert _apply_history(before, {}).equals(before)
