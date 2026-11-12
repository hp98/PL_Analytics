"""Tests for configuration loading and URL construction."""

from __future__ import annotations

from pipeline.config import load_config


def test_config_loads_seasons() -> None:
    cfg = load_config()
    assert "2020-21" in cfg.player_gameweek_seasons
    assert cfg.current_season == "2026-27"
    # Prior-only seasons must not overlap the star-schema window.
    assert set(cfg.prior_only_seasons).isdisjoint(cfg.player_gameweek_seasons)
    # The long-run prior window spans 2016-17 -> present.
    assert cfg.all_prior_seasons[0] == "2016-17"
    assert cfg.all_prior_seasons[-1] == cfg.player_gameweek_seasons[-1]


def test_vaastav_url_construction() -> None:
    cfg = load_config()
    url = cfg.vaastav.url("2023-24", "merged_gw")
    assert url.endswith("/data/2023-24/gws/merged_gw.csv")
    assert url.startswith("https://raw.githubusercontent.com/")


def test_paths_are_absolute() -> None:
    cfg = load_config()
    assert cfg.paths.interim.is_absolute()
    assert cfg.paths.warehouse.is_absolute()
