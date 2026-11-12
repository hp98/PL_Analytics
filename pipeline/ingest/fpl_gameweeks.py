"""Ingest current-season gameweek stats straight from the FPL API.

The community archive only publishes a gameweek once it has *completed*, so
during a live gameweek it lags by days. The official ``event/{gw}/live/``
endpoint already carries the same per-player stats for every match that has been
played, so this module fills that gap: any fixture that has actually been played
is ingested immediately, rather than waiting for the archive.

Two honest caveats, both handled here:

* FPL adds official bonus only after a match is finalised. Until then the live
  feed reports ``bonus: 0``, which would understate ``total_points``. We compute
  provisional bonus from live BPS using FPL's real tie rule (verified against a
  completed gameweek with 0/610 mismatches) and add it in.
* The live endpoint carries match stats only -- no ownership (``selected``),
  transfer counts, or the price at that gameweek. Those come from each player's
  ``element-summary/{id}/`` history, which has them per fixture. Without it the
  top-up left them null and stamped today's price on past fixtures, so the
  Explorer showed "Selected: --" for everyone and season transfers-in silently
  omitted every topped-up gameweek, with nothing on screen to say so.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterable
from itertools import groupby
from typing import Any

import polars as pl
import structlog

from pipeline.config import Config
from pipeline.ingest.http import RawFetcher
from pipeline.ingest.schema import PLAYER_GW_SCHEMA

log = structlog.get_logger(__name__)

_POSITION_BY_TYPE = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD", 5: "MNG"}
_BONUS_BY_POSITION = {1: 3, 2: 2, 3: 1}

# Per-fixture fields only a player's history has (see module docstring).
_HISTORY_FIELDS = ("value", "selected", "transfers_in", "transfers_out", "transfers_balance")


def provisional_bonus(rows: list[tuple[int, int]]) -> dict[int, int]:
    """Bonus per element for one fixture, from ``(element, bps)`` pairs.

    FPL's rule is group-STARTING-position, not distinct value: two players tied
    on top both get 3, and the next player gets 1 (the "2" slot is consumed).
    """
    out: dict[int, int] = {}
    pos = 1
    for _bps, grp in groupby(sorted(rows, key=lambda r: -r[1]), key=lambda r: r[1]):
        members = list(grp)
        bonus = _BONUS_BY_POSITION.get(pos, 0)
        for element, _ in members:
            out[element] = bonus
        pos += len(members)
    return out


def _is_played(fixture: dict[str, Any]) -> bool:
    """A fixture whose stats are real, even if FPL hasn't finalised it yet."""
    return bool(
        (fixture.get("finished") or fixture.get("finished_provisional"))
        and (fixture.get("minutes") or 0) > 0
    )


def fetch_gameweek_rows(
    cfg: Config,
    fetcher: RawFetcher,
    bootstrap: dict[str, Any],
    fixtures: list[dict[str, Any]],
    gw: int,
    season: str,
) -> pl.DataFrame | None:
    """Player x fixture rows for one gameweek, shaped like PLAYER_GW_SCHEMA."""
    played = [f for f in fixtures if f.get("event") == gw and _is_played(f)]
    if not played:
        return None

    text = fetcher.fetch_text(
        f"{cfg.fpl_api_base}/event/{gw}/live/", f"fpl_api/event_{gw}_live.json"
    )
    if text is None:
        return None
    live = json.loads(text)

    teams = {t["id"]: t for t in bootstrap["teams"]}
    elements = {e["id"]: e for e in bootstrap["elements"]}
    fixture_by_id = {f["id"]: f for f in played}

    # Official bonus is added per fixture; where it isn't yet, derive it.
    bps_by_fixture: dict[int, list[tuple[int, int]]] = {}
    official_bonus: dict[int, int] = {}
    for el in live["elements"]:
        for ex in el.get("explain", []):
            fid = ex.get("fixture")
            if fid not in fixture_by_id:
                continue
            bps_by_fixture.setdefault(fid, []).append((el["id"], el["stats"]["bps"]))
            official_bonus[fid] = official_bonus.get(fid, 0) + el["stats"]["bonus"]
    prov_by_fixture = {
        fid: ({} if official_bonus.get(fid, 0) > 0 else provisional_bonus(rows))
        for fid, rows in bps_by_fixture.items()
    }

    rows: list[dict[str, Any]] = []
    for el in live["elements"]:
        meta = elements.get(el["id"])
        if meta is None:
            continue
        st = el["stats"]
        full_name = " ".join(
            part for part in (meta.get("first_name"), meta.get("second_name")) if part
        )
        for ex in el.get("explain", []):
            fid = ex.get("fixture")
            fx = fixture_by_id.get(fid)
            if fx is None:
                continue
            is_home = fx["team_h"] == meta["team"]
            opponent = fx["team_a"] if is_home else fx["team_h"]
            extra_bonus = prov_by_fixture.get(fid, {}).get(el["id"], 0)
            starts = st.get("starts")
            rows.append(
                {
                    "season": season,
                    "gw": gw,
                    "element": el["id"],
                    "name": full_name,
                    "position": _POSITION_BY_TYPE.get(meta["element_type"]),
                    "team": teams[meta["team"]]["name"],
                    "opponent_team": opponent,
                    "fixture": fid,
                    "was_home": is_home,
                    "kickoff_time": fx.get("kickoff_time"),
                    "minutes": st["minutes"],
                    "starts": starts,
                    "was_started": bool(starts) if starts is not None else None,
                    # The feed's total_points excludes bonus until it is added.
                    "total_points": st["total_points"] + extra_bonus,
                    "goals_scored": st["goals_scored"],
                    "assists": st["assists"],
                    "clean_sheets": st["clean_sheets"],
                    "goals_conceded": st["goals_conceded"],
                    "own_goals": st["own_goals"],
                    "penalties_saved": st["penalties_saved"],
                    "penalties_missed": st["penalties_missed"],
                    "yellow_cards": st["yellow_cards"],
                    "red_cards": st["red_cards"],
                    "saves": st["saves"],
                    "bonus": st["bonus"] + extra_bonus,
                    "bps": st["bps"],
                    "influence": float(st.get("influence") or 0),
                    "creativity": float(st.get("creativity") or 0),
                    "threat": float(st.get("threat") or 0),
                    "ict_index": float(st.get("ict_index") or 0),
                    "expected_goals": float(st.get("expected_goals") or 0),
                    "expected_assists": float(st.get("expected_assists") or 0),
                    "expected_goal_involvements": float(
                        st.get("expected_goal_involvements") or 0
                    ),
                    "expected_goals_conceded": float(st.get("expected_goals_conceded") or 0),
                    # Fallbacks only: _apply_history overwrites these from each
                    # player's history (see module docstring).
                    "value": meta["now_cost"],
                    "selected": None,
                    "transfers_in": None,
                    "transfers_out": None,
                    "transfers_balance": None,
                    "team_h_score": fx.get("team_h_score"),
                    "team_a_score": fx.get("team_a_score"),
                }
            )

    if not rows:
        return None
    df = pl.DataFrame(rows)
    exprs = [
        (pl.col(c) if c in df.columns else pl.lit(None)).cast(dtype, strict=False).alias(c)
        for c, dtype in PLAYER_GW_SCHEMA.items()
    ]
    return df.select(exprs)


def _history_fields(
    cfg: Config, fetcher: RawFetcher, elements: Iterable[int]
) -> dict[tuple[int, int], dict[str, Any]]:
    """(element, fixture) -> ownership, transfers and price at that fixture.

    One request per player, so this is a few minutes cold. Today's raw dump is
    reused on a re-run the same day -- safe, because a player's history only
    changes when a gameweek finishes. A failure for one player is logged and
    skipped; that player's rows keep the live-feed values rather than failing
    the whole ingest.
    """
    gap = float(cfg.raw["sources"]["fpl_api"].get("history_request_gap_seconds", 1.0))
    out: dict[tuple[int, int], dict[str, Any]] = {}
    fetched = reused = failed = 0
    for el in sorted(set(elements)):
        rel = f"fpl_api/element_summary/{el}.json"
        cached = fetcher.raw_dir / rel
        try:
            if cached.exists():
                text: str | None = cached.read_text(encoding="utf-8")
                reused += 1
            else:
                text = fetcher.fetch_text(f"{cfg.fpl_api_base}/element-summary/{el}/", rel)
                fetched += 1
                time.sleep(gap)  # bulk crawl: hold to ~1 req/s on top of the throttle
            history = json.loads(text).get("history", []) if text else []
        except Exception as exc:  # noqa: BLE001 -- one bad player must not sink the ingest
            failed += 1
            log.warning("history_fetch_failed", element=el, error=str(exc))
            continue
        for h in history:
            out[(el, int(h["fixture"]))] = {k: h.get(k) for k in _HISTORY_FIELDS}
    log.info("history_fields", fetched=fetched, reused=reused, failed=failed, rows=len(out))
    return out


def _apply_history(
    df: pl.DataFrame, hist: dict[tuple[int, int], dict[str, Any]]
) -> pl.DataFrame:
    """Overlay history values onto top-up rows, keeping live values as fallback."""
    if not hist:
        return df
    patch = pl.DataFrame(
        [{"element": e, "fixture": f, **{f"h_{k}": v[k] for k in _HISTORY_FIELDS}}
         for (e, f), v in hist.items()]
    ).with_columns(
        pl.col("element").cast(df.schema["element"]),
        pl.col("fixture").cast(df.schema["fixture"]),
    )
    joined = df.join(patch, on=["element", "fixture"], how="left")
    return joined.with_columns(
        [
            pl.coalesce(pl.col(f"h_{k}").cast(df.schema[k], strict=False), pl.col(k)).alias(k)
            for k in _HISTORY_FIELDS
        ]
    ).select(df.columns)


def fetch_missing_gameweeks(
    cfg: Config,
    fetcher: RawFetcher,
    bootstrap: dict[str, Any],
    fixtures: list[dict[str, Any]],
    have_gws: set[int],
) -> pl.DataFrame | None:
    """Rows for every played current-season gameweek the archive is missing."""
    season = cfg.current_season
    played_gws = sorted(
        {int(f["event"]) for f in fixtures if f.get("event") and _is_played(f)}
    )
    frames: list[pl.DataFrame] = []
    for gw in played_gws:
        if gw in have_gws:
            continue
        df = fetch_gameweek_rows(cfg, fetcher, bootstrap, fixtures, gw, season)
        if df is not None and df.height:
            frames.append(df)
            log.info("api_gameweek_ingested", season=season, gw=gw, rows=df.height)
    if not frames:
        return None
    df = pl.concat(frames, how="vertical")
    return _apply_history(df, _history_fields(cfg, fetcher, df["element"].unique().to_list()))
