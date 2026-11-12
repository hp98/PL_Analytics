"""Canonical, cross-season schema for the player-gameweek fact source.

The vaastav ``merged_gw.csv`` drifts between seasons: ``position`` appears from
2020-21, ``starts`` and the expected-goals family (xG/xA/xGI/xGC) only from
2022-23. This module reindexes every season onto one stable, typed schema,
adding missing optional columns as typed nulls, so the downstream dbt/DuckDB
layer sees a single consistent shape (§2, §5 of the brief).
"""

from __future__ import annotations

import polars as pl

# Canonical column -> polars dtype for the normalised player-gameweek frame.
# Order is stable so the emitted parquet is deterministic. Values are dtype
# classes (e.g. pl.Int16), hence type[pl.DataType].
PLAYER_GW_SCHEMA: dict[str, type[pl.DataType]] = {
    "season": pl.Utf8,
    "gw": pl.Int16,
    "element": pl.Int32,
    "name": pl.Utf8,
    "position": pl.Utf8,          # canonicalised to GKP/DEF/MID/FWD
    "team": pl.Utf8,
    "opponent_team": pl.Int16,    # opponent team id within the season
    "fixture": pl.Int32,
    "was_home": pl.Boolean,
    "kickoff_time": pl.Utf8,      # ISO string; parsed to timestamp in dbt
    "minutes": pl.Int16,
    "starts": pl.Int8,            # nullable pre-2022-23
    "was_started": pl.Boolean,    # derived from `starts`; null when unknown
    "total_points": pl.Int16,
    "goals_scored": pl.Int16,
    "assists": pl.Int16,
    "clean_sheets": pl.Int8,
    "goals_conceded": pl.Int16,
    "own_goals": pl.Int8,
    "penalties_saved": pl.Int8,
    "penalties_missed": pl.Int8,
    "yellow_cards": pl.Int8,
    "red_cards": pl.Int8,
    "saves": pl.Int16,
    "bonus": pl.Int8,
    "bps": pl.Int16,
    "influence": pl.Float32,
    "creativity": pl.Float32,
    "threat": pl.Float32,
    "ict_index": pl.Float32,
    "expected_goals": pl.Float32,               # nullable pre-2022-23
    "expected_assists": pl.Float32,             # nullable pre-2022-23
    "expected_goal_involvements": pl.Float32,   # nullable pre-2022-23
    "expected_goals_conceded": pl.Float32,      # nullable pre-2022-23
    "value": pl.Int16,            # price at deadline, in tenths of £m (55 == £5.5)
    "selected": pl.Int32,         # count of managers selecting the player
    "transfers_in": pl.Int32,
    "transfers_out": pl.Int32,
    "transfers_balance": pl.Int32,
    "team_h_score": pl.Int8,
    "team_a_score": pl.Int8,
}

# Columns that MUST exist in the source for a season to be usable. If any are
# missing we raise, rather than silently emitting a broken season.
REQUIRED_SOURCE_COLUMNS: frozenset[str] = frozenset(
    {
        "element",
        "name",
        "GW",
        "minutes",
        "total_points",
        "opponent_team",
        "was_home",
        "value",
    }
)

# element_type id -> canonical position (from players_raw when merged_gw lacks it).
# element_type 5 ("MNG") is the Assistant Manager asset FPL trialled in 2024-25
# only. Kept as a distinct MNG category so no historical row is silently dropped;
# downstream GKP/DEF/MID/FWD filters exclude it naturally.
_ELEMENT_TYPE_TO_POSITION = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD", 5: "MNG"}

# Normalise the various position spellings seen across seasons.
_POSITION_ALIASES = {
    "GK": "GKP",
    "GKP": "GKP",
    "DEF": "DEF",
    "MID": "MID",
    "FWD": "FWD",
    "FW": "FWD",
    "AM": "MNG",    # Assistant Manager (2024-25 only)
    "MNG": "MNG",
}


def canonicalise_position(value: str | None) -> str | None:
    if value is None:
        return None
    return _POSITION_ALIASES.get(value.strip().upper())


def normalise_player_gameweek(
    raw: pl.DataFrame,
    season: str,
    players_raw: pl.DataFrame | None = None,
) -> pl.DataFrame:
    """Reindex one season's ``merged_gw`` frame onto :data:`PLAYER_GW_SCHEMA`.

    Args:
        raw: the parsed ``merged_gw.csv`` for the season.
        season: FPL season label, e.g. ``"2022-23"``.
        players_raw: parsed ``players_raw.csv``, used to backfill ``position``
            when the season's ``merged_gw`` predates the ``position`` column.

    Raises:
        ValueError: if a required source column is absent.
    """
    missing = REQUIRED_SOURCE_COLUMNS - set(raw.columns)
    if missing:
        raise ValueError(f"{season}: merged_gw missing required columns: {sorted(missing)}")

    df = raw.rename({"GW": "gw"}) if "GW" in raw.columns else raw

    # Backfill position from players_raw.element_type when absent.
    if "position" not in df.columns:
        if players_raw is None or "element_type" not in players_raw.columns:
            raise ValueError(f"{season}: no position column and no players_raw fallback")
        pos_map = players_raw.select(
            pl.col("id").alias("element"),
            pl.col("element_type")
            .replace_strict(_ELEMENT_TYPE_TO_POSITION, default=None)
            .alias("position"),
        )
        df = df.join(pos_map, on="element", how="left")

    # Build each canonical column as an expression, defaulting to a typed null.
    exprs: list[pl.Expr] = []
    for col, dtype in PLAYER_GW_SCHEMA.items():
        if col == "season":
            exprs.append(pl.lit(season).cast(dtype).alias(col))
        elif col == "was_started":
            if "starts" in df.columns:
                exprs.append((pl.col("starts") == 1).cast(dtype).alias(col))
            else:
                exprs.append(pl.lit(None).cast(dtype).alias(col))
        elif col == "position":
            src = pl.col("position") if "position" in df.columns else pl.lit(None)
            # Canonicalise spelling via a mapping over the string values.
            exprs.append(
                src.cast(pl.Utf8)
                .str.to_uppercase()
                .str.strip_chars()
                .replace_strict(_POSITION_ALIASES, default=None)
                .cast(dtype)
                .alias(col)
            )
        elif col == "was_home":
            # Arrives as native bool in some seasons and "True"/"False" strings
            # in others; normalise both to a real Boolean.
            if "was_home" in df.columns:
                lowered = pl.col("was_home").cast(pl.Utf8).str.to_lowercase()
                exprs.append(
                    pl.when(lowered.is_in(["true", "1", "t"]))
                    .then(pl.lit(True))
                    .when(lowered.is_in(["false", "0", "f"]))
                    .then(pl.lit(False))
                    .otherwise(pl.lit(None))
                    .cast(dtype)
                    .alias(col)
                )
            else:
                exprs.append(pl.lit(None).cast(dtype).alias(col))
        elif col in df.columns:
            exprs.append(pl.col(col).cast(dtype, strict=False).alias(col))
        else:
            exprs.append(pl.lit(None).cast(dtype).alias(col))

    return df.select(exprs)
