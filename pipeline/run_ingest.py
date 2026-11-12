"""CLI entrypoint for the ingest stage.

Usage:
    uv run python -m pipeline.run_ingest                 # star-schema seasons
    uv run python -m pipeline.run_ingest --with-priors   # + 2016-17..2019-20
    uv run python -m pipeline.run_ingest --seasons 2023-24 2024-25
"""

from __future__ import annotations

import argparse
import sys

import structlog

from pipeline.config import load_config
from pipeline.ingest.http import RawFetcher
from pipeline.ingest.vaastav import ingest_vaastav
from pipeline.logging_setup import configure_json_logging


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingest the vaastav FPL archive.")
    p.add_argument(
        "--with-priors",
        action="store_true",
        help="Also ingest the prior-only seasons used for positional priors.",
    )
    p.add_argument(
        "--seasons",
        nargs="+",
        default=None,
        help="Explicit season labels to ingest (overrides config selection).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_json_logging()
    log = structlog.get_logger("run_ingest")
    args = _parse_args(argv)
    cfg = load_config()

    if args.seasons:
        seasons = args.seasons
    elif args.with_priors:
        seasons = cfg.all_prior_seasons
    else:
        seasons = cfg.player_gameweek_seasons

    log.info("ingest_start", seasons=seasons)
    with RawFetcher(cfg) as fetcher:
        result = ingest_vaastav(cfg, seasons, fetcher)

    log.info(
        "ingest_done",
        seasons_ingested=result.seasons_ingested,
        seasons_skipped=result.seasons_skipped,
        player_gw_rows=result.player_gw_rows,
        api_topup_rows=result.api_topup_rows,
    )
    # Non-zero exit only if nothing was ingested at all.
    return 0 if result.seasons_ingested else 1


if __name__ == "__main__":
    sys.exit(main())
