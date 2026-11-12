"""Thin, server-side adapter for the official FPL API.

Used by the cold-plane publish step to bake current-season bootstrap + fixtures
into static bundles. The browser cannot call this API (no CORS headers, §2/§3);
Python in CI can. The live in-gameweek proxy is a separate concern (M3 Worker).
"""

from __future__ import annotations

import json
from typing import Any

from pipeline.config import Config
from pipeline.ingest.http import RawFetcher


def _get_json(fetcher: RawFetcher, url: str, dest_rel: str) -> Any:
    text = fetcher.fetch_text(url, dest_rel)
    if text is None:
        raise RuntimeError(f"FPL API returned 404 for {url}")
    return json.loads(text)


def fetch_bootstrap(cfg: Config, fetcher: RawFetcher) -> dict[str, Any]:
    """bootstrap-static: elements, teams, events, element_types."""
    url = f"{cfg.fpl_api_base}/bootstrap-static/"
    data: dict[str, Any] = _get_json(fetcher, url, "fpl_api/bootstrap-static.json")
    return data


def fetch_fixtures(cfg: Config, fetcher: RawFetcher) -> list[dict[str, Any]]:
    """All fixtures for the current season, including upcoming (unfinished)."""
    url = f"{cfg.fpl_api_base}/fixtures/"
    data: list[dict[str, Any]] = _get_json(fetcher, url, "fpl_api/fixtures.json")
    return data
