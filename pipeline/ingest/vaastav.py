"""Ingest the vaastav community archive into normalised interim parquet.

Produces four unioned parquet tables under ``data/interim``:
    - ``player_gameweek.parquet``  (fully typed via schema.PLAYER_GW_SCHEMA)
    - ``players.parquet``          (per-season element metadata)
    - ``teams.parquet``            (per-season team dimension)
    - ``fixtures.parquet``         (per-season fixtures)

Each season is fetched and dumped verbatim first (RawFetcher), then parsed. A
single missing/broken season is logged and skipped, never fatal (§4).
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import polars as pl
import structlog

from pipeline.config import Config
from pipeline.ingest.fpl_api import fetch_bootstrap, fetch_fixtures
from pipeline.ingest.fpl_gameweeks import fetch_missing_gameweeks
from pipeline.ingest.http import RawFetcher
from pipeline.ingest.schema import PLAYER_GW_SCHEMA, normalise_player_gameweek

log = structlog.get_logger(__name__)


@dataclass
class IngestResult:
    seasons_ingested: list[str]
    seasons_skipped: list[str]
    player_gw_rows: int
    api_topup_rows: int = 0


def _read_csv(text: str) -> pl.DataFrame:
    """Parse CSV text robustly (full-file schema inference, no date coercion)."""
    return pl.read_csv(
        io.StringIO(text),
        infer_schema_length=None,
        try_parse_dates=False,
        ignore_errors=False,
    )


def _add_season(df: pl.DataFrame, season: str) -> pl.DataFrame:
    return df.with_columns(pl.lit(season).alias("season"))


def ingest_vaastav(cfg: Config, seasons: list[str], fetcher: RawFetcher) -> IngestResult:
    """Fetch and normalise the given seasons, writing interim parquet."""
    cfg.paths.ensure()
    src = cfg.vaastav

    pgw_frames: list[pl.DataFrame] = []
    players_frames: list[pl.DataFrame] = []
    teams_frames: list[pl.DataFrame] = []
    fixtures_frames: list[pl.DataFrame] = []
    ingested: list[str] = []
    skipped: list[str] = []

    for season in seasons:
        try:
            merged_text = fetcher.fetch_text(
                src.url(season, "merged_gw"), f"vaastav/{season}/merged_gw.csv"
            )
            if merged_text is None:
                log.warning("season_skipped_no_merged_gw", season=season)
                skipped.append(season)
                continue

            players_text = fetcher.fetch_text(
                src.url(season, "players_raw"), f"vaastav/{season}/players_raw.csv"
            )
            teams_text = fetcher.fetch_text(
                src.url(season, "teams"), f"vaastav/{season}/teams.csv"
            )
            fixtures_text = fetcher.fetch_text(
                src.url(season, "fixtures"), f"vaastav/{season}/fixtures.csv"
            )

            players_raw = _read_csv(players_text) if players_text else None
            merged = _read_csv(merged_text)

            pgw = normalise_player_gameweek(merged, season, players_raw)
            pgw_frames.append(pgw)

            if players_raw is not None:
                players_frames.append(_add_season(players_raw, season))
            if teams_text:
                teams_frames.append(_add_season(_read_csv(teams_text), season))
            if fixtures_text:
                fixtures_frames.append(_add_season(_read_csv(fixtures_text), season))

            ingested.append(season)
            log.info("season_ingested", season=season, rows=pgw.height)
        except Exception as exc:  # noqa: BLE001 — one bad season must not be fatal
            log.error("season_failed", season=season, error=str(exc))
            skipped.append(season)

    if not pgw_frames:
        raise RuntimeError("No seasons ingested; refusing to write empty interim data")

    # player_gameweek is uniformly typed, so a vertical concat is exact.
    player_gw = pl.concat(pgw_frames, how="vertical").select(list(PLAYER_GW_SCHEMA.keys()))

    # Top up the LIVE season from the official API. The community archive only
    # publishes a gameweek once it has completed, so mid-gameweek it lags by
    # days; the API already has the played fixtures. Never fatal — the archive
    # data stands on its own if this fails.
    api_rows = 0
    if cfg.current_season in ingested or cfg.current_season in seasons:
        try:
            have = set(
                player_gw.filter(pl.col("season") == cfg.current_season)["gw"].unique().to_list()
            )
            bootstrap = fetch_bootstrap(cfg, fetcher)
            fixtures = fetch_fixtures(cfg, fetcher)
            topup = fetch_missing_gameweeks(cfg, fetcher, bootstrap, fixtures, have)
            if topup is not None and topup.height:
                player_gw = pl.concat(
                    [player_gw, topup.select(list(PLAYER_GW_SCHEMA.keys()))], how="vertical"
                )
                api_rows = topup.height
                log.info("api_topup", season=cfg.current_season, rows=api_rows)
        except Exception as exc:  # noqa: BLE001 — top-up is best effort
            log.error("api_topup_failed", error=str(exc))

    # De-duplicate the (season, element, fixture) grain. The vaastav merged_gw
    # occasionally emits byte-identical duplicate rows for a player-fixture (a
    # source defect, not a real double gameweek — a DGW has DIFFERENT fixtures).
    # Sort so the more-complete row wins if duplicates ever disagree, then keep
    # one per grain. This removes a source defect; it invents no data.
    before = player_gw.height
    player_gw = player_gw.sort(
        ["season", "element", "fixture", "minutes", "total_points"],
        descending=[False, False, False, True, True],
    ).unique(subset=["season", "element", "fixture"], keep="first", maintain_order=True)
    dropped = before - player_gw.height
    if dropped:
        log.warning("deduped_grain_rows", dropped=dropped)

    _write(cfg, "player_gameweek", player_gw)

    # The dimension/fixture frames drift across seasons; diagonal_relaxed unions
    # them by name, supertyping mismatched columns and filling gaps with nulls.
    # The dbt staging models select and cast only the columns they use.
    if players_frames:
        _write(cfg, "players", pl.concat(players_frames, how="diagonal_relaxed"))
    if teams_frames:
        _write(cfg, "teams", pl.concat(teams_frames, how="diagonal_relaxed"))
    if fixtures_frames:
        _write(cfg, "fixtures", pl.concat(fixtures_frames, how="diagonal_relaxed"))

    return IngestResult(ingested, skipped, player_gw.height, api_rows)


def _write(cfg: Config, name: str, df: pl.DataFrame) -> None:
    dest = cfg.paths.interim / f"{name}.parquet"
    df.write_parquet(dest)
    log.info("interim_written", table=name, rows=df.height, dest=str(dest))
