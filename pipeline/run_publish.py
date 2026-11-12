"""CLI entrypoint for the publish stage.

Exports warehouse parquet bundles and live FPL API JSON into the frontend's
static data directory, then writes a manifest.

Usage:
    uv run python -m pipeline.run_publish            # full: bundles + model
    uv run python -m pipeline.run_publish --light    # fast: live JSON only

`--light` skips the parquet export, the projection model and the optimiser, and
refreshes only the cheap bootstrap-derived bundles (prices, ownership, transfer
momentum, fixtures). It runs in seconds, so it can be polled frequently to keep
fast-moving data near-real-time without re-running a multi-minute model whose
inputs (completed matches) only change once a gameweek finishes.
"""

from __future__ import annotations

import argparse
import sys

import duckdb
import structlog

from pipeline.config import load_config
from pipeline.ingest.fpl_api import fetch_bootstrap, fetch_fixtures
from pipeline.ingest.http import RawFetcher
from pipeline.logging_setup import configure_json_logging
from pipeline.model.forecast import run_forecast, summarise_projections
from pipeline.optimise.candidates import build_candidates
from pipeline.optimise.squad import optimal_squad
from pipeline.publish import (
    TableBundle,
    build_fixture_ticker,
    build_gameweeks,
    build_manifest,
    build_players_live,
    build_price_predictor,
    build_team_strength,
    build_teams,
    export_parquet_bundles,
    read_backtest_summary,
    write_json,
)


class _SkipModel(Exception):
    """Control-flow marker: skip the model stage on a light refresh."""


def main(argv: list[str] | None = None) -> int:
    configure_json_logging()
    log = structlog.get_logger("run_publish")
    parser = argparse.ArgumentParser(description="Publish static bundles.")
    parser.add_argument(
        "--light",
        action="store_true",
        help="Refresh only live bootstrap-derived JSON (skip parquet + model).",
    )
    args = parser.parse_args(argv)

    cfg = load_config()
    out = cfg.paths.frontend_data
    out.mkdir(parents=True, exist_ok=True)

    # 1) Parquet bundles for in-browser DuckDB-WASM. These only change when a
    # gameweek completes, so a light refresh reuses what is already published.
    bundles = (
        []
        if args.light
        else export_parquet_bundles(
            cfg.paths.warehouse / "fpl.duckdb", cfg.publish.parquet_tables, out
        )
    )

    # 2) Live FPL API -> JSON bundles (server-side; browser can't reach it).
    with RawFetcher(cfg) as fetcher:
        bootstrap = fetch_bootstrap(cfg, fetcher)
        fixtures = fetch_fixtures(cfg, fetcher)

    players_live = build_players_live(bootstrap)
    gameweeks = build_gameweeks(bootstrap)
    strength = build_team_strength(cfg.paths.warehouse / "fpl.duckdb")
    ticker = build_fixture_ticker(
        bootstrap, fixtures, cfg.publish.ticker_horizon_gws, strength
    )

    price_predictor = build_price_predictor(bootstrap, cfg.raw["price_predictor"])
    teams = build_teams(bootstrap, cfg.paths.warehouse / "fpl.duckdb")

    write_json(out / "players_live.json", players_live)
    write_json(out / "gameweeks.json", gameweeks)
    write_json(out / "fixture_ticker.json", ticker)
    write_json(out / "price_predictor.json", price_predictor)
    write_json(out / "teams.json", teams)

    json_names = ["players_live", "gameweeks", "fixture_ticker", "price_predictor", "teams"]

    # Model projections for upcoming gameweeks. Guarded: a model error must not
    # block the data publish (the app degrades to stats-only, per §9).
    try:
        if args.light:
            raise _SkipModel
        proj, gws = run_forecast(cfg, bootstrap, fixtures)
        projections = summarise_projections(proj, gws)
        write_json(out / "projections.json", projections)
        json_names.append("projections")
        log.info("projections_published", players=len(projections["players"]), horizon=gws)

        # Optimal squad from scratch over the next 5 GWs (§7 modes 1 & 3). Used
        # as the benchmark for the client-side team rating.
        opt = cfg.raw["optimiser"]
        cand = build_candidates(proj, bootstrap, gws[:5])
        sol = optimal_squad(
            cand,
            budget=100.0,
            bench_lambda=opt["bench_lambda"],
            pool_size=opt["candidate_pool_size"],
        )
        optimal = {
            "horizon": gws[:5],
            "xi_xp": sol.xi_xp,
            "cost": sol.cost,
            "bank": sol.bank,
            "status": sol.status,
            "picks": [
                {
                    "element": p.element,
                    "web_name": p.web_name,
                    "position": p.position,
                    "team": p.team,
                    "price": p.price,
                    "xp": round(p.xp, 2),
                    "is_start": p.is_start,
                    "is_captain": p.is_captain,
                }
                for p in sol.picks
            ],
        }
        write_json(out / "optimal_squad.json", optimal)
        json_names.append("optimal_squad")
        log.info("optimal_squad_published", status=sol.status, xi_xp=sol.xi_xp, cost=sol.cost)
    except _SkipModel:
        # Light refresh: keep the projections/optimal-squad already on disk.
        for name in ("projections", "optimal_squad"):
            if (out / f"{name}.json").exists():
                json_names.append(name)
        log.info("model_skipped_light_refresh")
    except Exception:  # noqa: BLE001 — projections/optimiser are optional; log and continue
        log.exception("projections_failed")

    extra_json = {name: (out / f"{name}.json").stat().st_size for name in json_names}

    # 3) data-as-of = latest played match in the warehouse.
    con = duckdb.connect(str(cfg.paths.warehouse / "fpl.duckdb"), read_only=True)
    try:
        as_of_row = con.execute(
            "select max(kickoff_time)::varchar from fct_player_gameweek"
        ).fetchone()
        data_as_of = as_of_row[0] if as_of_row else None
        gw_row = con.execute(
            "select max(gw) from fct_player_gameweek where season = ?",
            [cfg.current_season],
        ).fetchone()
        data_as_of_gw = int(gw_row[0]) if gw_row and gw_row[0] is not None else None
    finally:
        con.close()

    if args.light:
        # Preserve the parquet listing from the last full publish.
        prior = out / "manifest.json"
        if prior.exists():
            import json as _json

            old = _json.loads(prior.read_text(encoding="utf-8"))
            bundles = [
                TableBundle(b["name"], b["rows"], b["bytes"])
                for b in old.get("parquet_tables", [])
            ]

    model_summary = read_backtest_summary(cfg.paths.warehouse.parent.parent / "reports")
    manifest = build_manifest(
        seasons=cfg.player_gameweek_seasons,
        current_season=cfg.current_season,
        bundles=bundles,
        ticker=ticker,
        data_as_of=data_as_of,
        data_as_of_gw=data_as_of_gw,
        extra_json=extra_json,
        model=model_summary,
    )
    write_json(out / "manifest.json", manifest)

    log.info(
        "publish_done",
        out=str(out),
        tables=[b.name for b in bundles],
        players=len(players_live),
        ticker_teams=len(ticker["teams"]),
        current_gw=ticker.get("current_gw"),
        next_gw=ticker.get("next_gw"),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
