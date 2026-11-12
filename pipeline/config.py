"""Typed access to ``config.yaml`` and resolved filesystem paths.

One concern per file: this module owns configuration loading only. Everything
else imports :func:`load_config` and reads the typed dataclasses.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

# The repo root is the parent of the ``pipeline`` package directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config.yaml"


@dataclass(frozen=True)
class HttpConfig:
    timeout_seconds: float
    max_retries: int
    backoff_base_seconds: float
    backoff_max_seconds: float
    polite_delay_seconds: float
    user_agent: str


@dataclass(frozen=True)
class VaastavSource:
    raw_base: str
    files: dict[str, str]

    def url(self, season: str, file_key: str) -> str:
        """Build a raw-CSV URL for ``file_key`` in ``season``."""
        rel = self.files[file_key].format(season=season)
        return f"{self.raw_base}/{rel}"


@dataclass(frozen=True)
class Paths:
    raw: Path
    interim: Path
    warehouse: Path
    public: Path
    frontend_data: Path

    def ensure(self) -> None:
        for p in (self.raw, self.interim, self.warehouse, self.public, self.frontend_data):
            p.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class PublishConfig:
    parquet_tables: list[str]
    ticker_horizon_gws: int


@dataclass(frozen=True)
class Config:
    raw: dict[str, Any]
    http: HttpConfig
    vaastav: VaastavSource
    fpl_api_base: str
    paths: Paths
    publish: PublishConfig
    player_gameweek_seasons: list[str]
    prior_only_seasons: list[str]
    current_season: str

    @property
    def all_prior_seasons(self) -> list[str]:
        """2016-17 -> present, used for long-run positional priors."""
        return [*self.prior_only_seasons, *self.player_gameweek_seasons]


def _abs(root: Path, rel: str) -> Path:
    return (root / rel).resolve()


@lru_cache(maxsize=1)
def load_config(path: Path | None = None) -> Config:
    """Load and validate ``config.yaml`` into typed dataclasses (cached)."""
    cfg_path = path or CONFIG_PATH
    data: dict[str, Any] = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))

    http = HttpConfig(**data["http"])
    vaastav = VaastavSource(**data["sources"]["vaastav"])
    paths = Paths(
        raw=_abs(REPO_ROOT, data["paths"]["raw"]),
        interim=_abs(REPO_ROOT, data["paths"]["interim"]),
        warehouse=_abs(REPO_ROOT, data["paths"]["warehouse"]),
        public=_abs(REPO_ROOT, data["paths"]["public"]),
        frontend_data=_abs(REPO_ROOT, data["paths"]["frontend_data"]),
    )
    publish = PublishConfig(
        parquet_tables=list(data["publish"]["parquet_tables"]),
        ticker_horizon_gws=int(data["publish"]["ticker_horizon_gws"]),
    )
    return Config(
        raw=data,
        http=http,
        vaastav=vaastav,
        fpl_api_base=str(data["sources"]["fpl_api"]["base"]),
        paths=paths,
        publish=publish,
        player_gameweek_seasons=list(data["seasons"]["player_gameweek"]),
        prior_only_seasons=list(data["seasons"]["prior_only"]),
        current_season=str(data["seasons"]["current"]),
    )
