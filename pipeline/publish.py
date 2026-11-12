"""Publish stage: turn the warehouse + live FPL API into static bundles the
frontend loads directly (no backend, no CORS). Emits:

    <frontend_data>/
        mart_player_form.parquet, fct_player_gameweek.parquet, dim_*.parquet
        fixture_ticker.json     # team x next-N-GW grid with FDR
        players_live.json       # current-season player list (price/ownership/status)
        gameweeks.json          # event metadata (deadlines, averages)
        teams.json              # team identity + official badge code (crest lookup)
        price_predictor.json    # heuristic P(rise)/P(fall) per player
        manifest.json           # build sha/timestamp, data-as-of, table sizes

The parquet bundles are queried in-browser by DuckDB-WASM; the JSON bundles back
the lighter routes (ticker, live overlay) without loading DuckDB.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import structlog

log = structlog.get_logger(__name__)

POSITION_BY_TYPE = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD", 5: "MNG"}


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested)
# --------------------------------------------------------------------------- #
def scale_to_fdr(value: float, lo: float, hi: float) -> int:
    """Map a team-strength value onto the 1..5 FDR scale (higher = harder)."""
    if hi <= lo:
        return 3
    norm = (value - lo) / (hi - lo)
    norm = min(1.0, max(0.0, norm))
    return int(round(1 + norm * 4))


def _strength_bounds(teams: list[dict[str, Any]], key: str) -> tuple[float, float]:
    vals = [float(t[key]) for t in teams if t.get(key) is not None]
    return (min(vals), max(vals)) if vals else (0.0, 1.0)


def build_players_live(bootstrap: dict[str, Any]) -> list[dict[str, Any]]:
    """Current-season player list from bootstrap elements."""
    teams = {t["id"]: t for t in bootstrap["teams"]}
    out: list[dict[str, Any]] = []
    for e in bootstrap["elements"]:
        team = teams.get(e["team"], {})
        out.append(
            {
                "element": e["id"],
                "web_name": e["web_name"],
                "first_name": e.get("first_name"),
                "second_name": e.get("second_name"),
                "team_id": e["team"],
                "team_short": team.get("short_name"),
                "position": POSITION_BY_TYPE.get(e["element_type"]),
                "price_m": e["now_cost"] / 10.0,
                "ownership_pct": float(e.get("selected_by_percent") or 0.0),
                "status": e.get("status"),
                "chance_of_playing_next_round": e.get("chance_of_playing_next_round"),
                "news": e.get("news") or "",
                "form": float(e.get("form") or 0.0),
                "total_points": e.get("total_points", 0),
                "ep_next": float(e.get("ep_next") or 0.0),
            }
        )
    return out


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def build_price_predictor(
    bootstrap: dict[str, Any], cfg: dict[str, Any]
) -> list[dict[str, Any]]:
    """Heuristic P(rise)/P(fall) tonight from net-transfer momentum (§8.8).

    NOT the real (undisclosed) FPL algorithm — a transparent momentum model,
    normalised by ownership so popular players need more transfers to move.
    """
    teams = {t["id"]: t["short_name"] for t in bootstrap["teams"]}
    rt, rs = cfg["rise_threshold"], cfg["rise_scale"]
    ft, fs = cfg["fall_threshold"], cfg["fall_scale"]
    out: list[dict[str, Any]] = []
    for e in bootstrap["elements"]:
        if e["element_type"] not in (1, 2, 3, 4):
            continue
        net = int(e.get("transfers_in_event", 0)) - int(e.get("transfers_out_event", 0))
        own = float(e.get("selected_by_percent") or 0.0)
        momentum = net / ((own + 0.5) * 1000.0)
        # Momentum is heavy-tailed — it runs past 40 for a bandwagon pick, which
        # pinned a sigmoid on the raw value at 1.0 for everyone near the top and
        # destroyed the ranking. Compress it logarithmically first so the whole
        # table spreads instead of ending in a wall of "100%".
        signal = math.copysign(math.log1p(abs(momentum)), momentum)
        p_rise = _sigmoid((signal - rt) / rs)
        p_fall = _sigmoid((-signal - ft) / fs)
        out.append(
            {
                "element": e["id"],
                "web_name": e["web_name"],
                "team": teams.get(e["team"], "?"),
                "position": POSITION_BY_TYPE.get(e["element_type"]),
                "price_m": e["now_cost"] / 10.0,
                "ownership_pct": own,
                "net_transfers": net,
                # The underlying signal, exposed so the number behind the
                # probability is inspectable rather than a black box.
                "momentum": round(momentum, 2),
                "already_changed": int(e.get("cost_change_event", 0)),
                "p_rise": round(p_rise, 3),
                "p_fall": round(p_fall, 3),
            }
        )
    out.sort(key=lambda r: r["p_rise"] - r["p_fall"], reverse=True)
    return out


def build_team_strength(warehouse: Path, lookback: int = 10) -> dict[str, dict[str, float]]:
    """Per-team attacking / defensive strength from our own xG history.

    FPL's `strength_attack_*` / `strength_defence_*` fields are returned as 0 for
    every club in some seasons (they are unpopulated upstream), which collapses
    any scale built on them to a constant. So the ticker's attack/defence
    difficulty is derived here from real match xG instead: each team's average
    xG scored and conceded over its most recent `lookback` matches, carried
    across season boundaries so the rating is meaningful from GW1.
    """
    if not warehouse.exists():
        return {}
    con = duckdb.connect(str(warehouse), read_only=True)
    try:
        rows = con.execute(
            """
            with tm as (
                select season, fixture_id, team_name,
                       any_value(kickoff_time) as ko,
                       sum(coalesce(expected_goals, 0)) as xg_for
                from fct_player_gameweek
                group by season, fixture_id, team_name
            ),
            paired as (
                select a.team_name, a.ko, a.xg_for, b.xg_for as xg_against
                from tm a
                join tm b
                  on a.season = b.season
                 and a.fixture_id = b.fixture_id
                 and a.team_name <> b.team_name
            ),
            ranked as (
                select *, row_number() over (partition by team_name order by ko desc) as rn
                from paired
            )
            select team_name, avg(xg_for), avg(xg_against), count(*)
            from ranked where rn <= ? group by team_name
            """,
            [lookback],
        ).fetchall()
    except Exception:  # noqa: BLE001 — fall back to official FDR if this fails
        return {}
    finally:
        con.close()
    return {
        str(name): {"attack": float(xgf), "defence": float(xga), "matches": int(n)}
        for name, xgf, xga, n in rows
        if xgf is not None and xga is not None
    }


def build_teams(bootstrap: dict[str, Any], warehouse: Path) -> list[dict[str, Any]]:
    """Team identity + official badge code, for the frontend's crest lookup.

    Current-season teams come from bootstrap (authoritative ids/codes). Historical
    teams are unioned in from dim_team so the Explorer can badge past seasons too;
    where a club appears in several seasons the most recent code wins.

    `code` indexes the official Premier League badge CDN
    (resources.premierleague.com/premierleague/badges/...), the same source the
    official game uses — we reference it rather than redistributing the crests.
    """
    rows: dict[str, dict[str, Any]] = {}

    # Historical first, so current-season values overwrite them.
    if warehouse.exists():
        con = duckdb.connect(str(warehouse), read_only=True)
        try:
            hist = con.execute(
                """
                select team_name, team_short_name, team_code, season
                from dim_team
                qualify row_number() over (
                    partition by team_name order by season desc
                ) = 1
                """
            ).fetchall()
        except Exception:  # noqa: BLE001 — historical badges are a nicety, not a gate
            hist = []
        finally:
            con.close()
        for name, short, code, _season in hist:
            if name and code:
                rows[str(name)] = {
                    "id": None,
                    "code": int(code),
                    "name": str(name),
                    "short_name": str(short) if short else None,
                }

    for t in bootstrap["teams"]:
        rows[str(t["name"])] = {
            "id": t["id"],
            "code": t["code"],
            "name": t["name"],
            "short_name": t["short_name"],
            "current": True,
        }

    return sorted(rows.values(), key=lambda r: str(r["name"]))


def build_gameweeks(bootstrap: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": ev["id"],
            "name": ev["name"],
            "deadline_time": ev.get("deadline_time"),
            "finished": ev.get("finished", False),
            "is_current": ev.get("is_current", False),
            "is_next": ev.get("is_next", False),
            "average_entry_score": ev.get("average_entry_score"),
            "highest_score": ev.get("highest_score"),
        }
        for ev in bootstrap["events"]
    ]


def upcoming_gameweeks(bootstrap: dict[str, Any], horizon: int) -> list[int]:
    """The next `horizon` gameweeks a manager can still pick for.

    Keyed on the DEADLINE, not FPL's `finished` flag: during a gameweek the flag
    stays false until every match is finalised, so a flag-based horizon keeps
    showing a gameweek whose deadline has passed and whose fixtures have already
    been played — useless for planning, and it looks broken in the ticker.
    """
    now = datetime.now(UTC)
    events = sorted(bootstrap["events"], key=lambda e: e["id"])
    upcoming: list[int] = []
    for e in events:
        deadline = e.get("deadline_time")
        if not deadline:
            continue
        when = datetime.fromisoformat(str(deadline).replace("Z", "+00:00"))
        if when > now:
            upcoming.append(e["id"])
    if not upcoming:  # season over — fall back to the last N events
        upcoming = [e["id"] for e in events][-horizon:]
    return upcoming[:horizon]


def build_fixture_ticker(
    bootstrap: dict[str, Any],
    fixtures: list[dict[str, Any]],
    horizon: int,
    strength: dict[str, dict[str, float]] | None = None,
) -> dict[str, Any]:
    """Team x next-N-GW grid with official + model attack/defence difficulty.

    Official FDR is FPL's own 1-5 rating. attack_fdr / defence_fdr come from our
    own xG-based team strength (see build_team_strength): a fixture can be easy
    for attackers and hard for defenders, which one combined number cannot say.

      attack_fdr  — how hard to SCORE: driven by the opponent's xG conceded
                    (mean defence -> 3; concede little -> 5).
      defence_fdr — how hard to keep a CLEAN SHEET: driven by the opponent's xG
                    scored, and nudged by home advantage.

    Falls back to the official FDR when no xG history is available.
    """
    teams = {t["id"]: t for t in bootstrap["teams"]}
    horizon_gws = upcoming_gameweeks(bootstrap, horizon)
    horizon_set = set(horizon_gws)

    strength = strength or {}
    # League spread of each rating, so 1-5 is calibrated against this league.
    xgf_vals = [v["attack"] for v in strength.values()]
    xga_vals = [v["defence"] for v in strength.values()]
    have_strength = len(xgf_vals) >= 6
    att_lo, att_hi = (min(xgf_vals), max(xgf_vals)) if have_strength else (0.0, 1.0)
    # Conceding LESS makes a team harder to attack, so the defensive axis is
    # inverted by negating the values (NOT by swapping lo/hi, which would make
    # hi < lo and trip scale_to_fdr's degenerate-range guard).
    def_lo, def_hi = (
        (-max(xga_vals), -min(xga_vals)) if have_strength else (0.0, 1.0)
    )

    # Home advantage nudges difficulty by a fifth of a band either way.
    def _clamp(v: float) -> int:
        return max(1, min(5, int(round(v))))

    # team_id -> gw -> list of cells
    cells: dict[int, dict[int, list[dict[str, Any]]]] = {
        tid: {gw: [] for gw in horizon_gws} for tid in teams
    }

    for fx in fixtures:
        gw = fx.get("event")
        if gw not in horizon_set:
            continue
        h, a = fx["team_h"], fx["team_a"]
        if h not in teams or a not in teams:
            continue
        for tid, opp_id, is_home, own_fdr in (
            (h, a, True, fx.get("team_h_difficulty")),
            (a, h, False, fx.get("team_a_difficulty")),
        ):
            opp = teams[opp_id]
            opp_strength = strength.get(opp["name"])
            if have_strength and opp_strength is not None:
                # Playing at home makes both jobs slightly easier.
                nudge = -0.35 if is_home else 0.35
                attack_fdr = _clamp(
                    scale_to_fdr(-opp_strength["defence"], def_lo, def_hi) + nudge
                )
                defence_fdr = _clamp(
                    scale_to_fdr(opp_strength["attack"], att_lo, att_hi) + nudge
                )
            else:
                fallback = own_fdr if own_fdr is not None else 3
                attack_fdr, defence_fdr = fallback, fallback
            cells[tid][gw].append(
                {
                    "opp_id": opp_id,
                    "opp_short": opp["short_name"],
                    "home": is_home,
                    "official_fdr": own_fdr,
                    "attack_fdr": attack_fdr,
                    "defence_fdr": defence_fdr,
                    "kickoff": fx.get("kickoff_time"),
                    "finished": fx.get("finished", False),
                }
            )

    team_rows: list[dict[str, Any]] = []
    for tid, t in teams.items():
        fdr_vals = [
            c["official_fdr"]
            for gw in horizon_gws
            for c in cells[tid][gw]
            if c["official_fdr"] is not None
        ]
        num_fx = sum(len(cells[tid][gw]) for gw in horizon_gws)
        team_rows.append(
            {
                "team_id": tid,
                "name": t["name"],
                "short_name": t["short_name"],
                "cells": {str(gw): cells[tid][gw] for gw in horizon_gws},
                "num_fixtures": num_fx,
                "sum_official_fdr": sum(fdr_vals) if fdr_vals else None,
                "avg_official_fdr": round(sum(fdr_vals) / len(fdr_vals), 2) if fdr_vals else None,
            }
        )
    team_rows.sort(key=lambda r: (r["avg_official_fdr"] is None, r["avg_official_fdr"] or 0))

    current = next((e["id"] for e in bootstrap["events"] if e.get("is_current")), None)
    nxt = next((e["id"] for e in bootstrap["events"] if e.get("is_next")), None)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "current_gw": current,
        "next_gw": nxt,
        "horizon": horizon_gws,
        "teams": team_rows,
    }


# --------------------------------------------------------------------------- #
# IO
# --------------------------------------------------------------------------- #
@dataclass
class TableBundle:
    name: str
    rows: int
    bytes: int


def export_parquet_bundles(
    warehouse: Path, tables: list[str], out_dir: Path
) -> list[TableBundle]:
    """COPY each warehouse relation to parquet under out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(warehouse), read_only=True)
    bundles: list[TableBundle] = []
    try:
        for name in tables:
            dest = out_dir / f"{name}.parquet"
            con.execute(
                f"COPY (SELECT * FROM {name}) TO '{dest.as_posix()}' (FORMAT PARQUET)"
            )
            count_row = con.execute(f"SELECT count(*) FROM {name}").fetchone()
            rows = count_row[0] if count_row else 0
            bundles.append(TableBundle(name, int(rows), dest.stat().st_size))
            log.info("parquet_exported", table=name, rows=rows, bytes=dest.stat().st_size)
    finally:
        con.close()
    return bundles


# How long to keep trying the atomic swap before giving up (see write_json).
# Deadline- rather than attempt-based: on a loaded machine a fixed attempt count
# expires in milliseconds and fails an entire publish over a transient lock,
# whereas publishing is not latency-critical and correctness is.
_REPLACE_DEADLINE_S = 15.0
_REPLACE_BACKOFF_MAX_S = 0.1


def write_json(path: Path, obj: Any) -> None:
    """Publish a JSON bundle ATOMICALLY.

    Writing in place (``path.write_text``) truncates the file first, so anything
    reading it during a refresh -- the dev server, the browser, a CDN origin
    pull -- can receive a half-written file and fail to parse it. That is what
    surfaced in the UI as "data unavailable": a measured ~8% of reads failed
    while the 416 KB projections bundle was being rewritten.

    Writing to a temporary file in the SAME directory and then ``os.replace``
    makes the swap atomic on both POSIX and Windows, so a reader sees either the
    complete old bundle or the complete new one, never a torn one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    # delete=False + same directory: os.replace cannot cross filesystems.
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(payload)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    # On Windows os.replace raises PermissionError while ANY process still has
    # the destination open for reading -- the dev server and the browser both do.
    # The swap is still atomic; it just has to wait for the reader to let go, so
    # retry briefly rather than failing a whole publish over a millisecond race.
    deadline = time.monotonic() + _REPLACE_DEADLINE_S
    backoff = 0.005
    last: Exception | None = None
    while True:
        try:
            os.replace(tmp_path, path)
            break
        except PermissionError as exc:  # noqa: PERF203 - retry is the point
            last = exc
            if time.monotonic() >= deadline:
                tmp_path.unlink(missing_ok=True)
                msg = f"could not atomically replace {path} within {_REPLACE_DEADLINE_S}s"
                raise OSError(msg) from last
            time.sleep(backoff)
            backoff = min(backoff * 2, _REPLACE_BACKOFF_MAX_S)
    log.info("json_written", path=str(path), bytes=path.stat().st_size)


def _git_sha() -> str:
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True)
            .strip()
        )
    except Exception:  # noqa: BLE001 — sha is best-effort provenance
        return "unknown"


def build_manifest(
    *,
    seasons: list[str],
    current_season: str,
    bundles: list[TableBundle],
    ticker: dict[str, Any],
    data_as_of: str | None,
    data_as_of_gw: int | None,
    extra_json: dict[str, int],
    model: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "build_timestamp": datetime.now(UTC).isoformat(),
        "git_sha": _git_sha(),
        "data_as_of": data_as_of,
        # Gameweek the completed-match data runs through. Live data (My Team,
        # Live GW, prices) is fetched in real time and is NOT bounded by this.
        "data_as_of_gw": data_as_of_gw,
        "current_season": current_season,
        "current_gw": ticker.get("current_gw"),
        "next_gw": ticker.get("next_gw"),
        "seasons": seasons,
        "parquet_tables": [
            {"name": b.name, "rows": b.rows, "bytes": b.bytes} for b in bundles
        ],
        "json_bundles": [{"name": k, "bytes": v} for k, v in extra_json.items()],
        "model": model,
    }


def read_backtest_summary(reports_dir: Path) -> dict[str, Any] | None:
    """Compact model-validation summary from the committed backtest report."""
    path = reports_dir / "backtest.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    xp = data.get("metrics", {}).get("xp", {})
    baselines = {
        k: v.get("spearman_per_gw")
        for k, v in data.get("metrics", {}).items()
        if k != "xp"
    }
    best = max(baselines, key=lambda k: baselines[k]) if baselines else None
    return {
        "ship_model": data.get("ship_model"),
        "verdict": data.get("verdict"),
        "model_spearman": xp.get("spearman_per_gw"),
        "best_baseline": best,
        "best_baseline_spearman": baselines.get(best) if best else None,
        "seasons": data.get("seasons"),
    }
