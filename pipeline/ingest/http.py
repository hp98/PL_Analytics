"""Polite, resilient HTTP fetching with verbatim raw dumps.

Design rules from the brief (§4): retry with exponential backoff, write the raw
response to a dated ``raw/`` folder *before* parsing, and be polite to hosts.
"""

from __future__ import annotations

import time
from datetime import date
from pathlib import Path

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pipeline.config import Config

log = structlog.get_logger(__name__)

# Exceptions worth retrying: transient network errors and 5xx/429 responses.
_RETRYABLE = (httpx.TransportError, httpx.HTTPStatusError)


class RawFetcher:
    """Fetch URLs with backoff and persist verbatim bytes under a dated folder.

    The dated folder (``raw/<YYYY-MM-DD>/``) makes every pipeline run
    reproducible and auditable: the exact source payload is kept before any
    parsing happens, so a bad parse can never be mistaken for bad source data.
    """

    def __init__(self, cfg: Config, run_date: date | None = None) -> None:
        self._cfg = cfg
        self._run_date = run_date or date.today()
        self._last_request_ts = 0.0
        self._client = httpx.Client(
            timeout=cfg.http.timeout_seconds,
            headers={"User-Agent": cfg.http.user_agent},
            follow_redirects=True,
        )

    # -- lifecycle ---------------------------------------------------------
    def __enter__(self) -> RawFetcher:
        return self

    def __exit__(self, *_exc: object) -> None:
        self._client.close()

    @property
    def raw_dir(self) -> Path:
        d = self._cfg.paths.raw / self._run_date.isoformat()
        d.mkdir(parents=True, exist_ok=True)
        return d

    # -- fetching ----------------------------------------------------------
    def _throttle(self) -> None:
        """Enforce a minimum gap between requests to be a polite client."""
        gap = self._cfg.http.polite_delay_seconds
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < gap:
            time.sleep(gap - elapsed)
        self._last_request_ts = time.monotonic()

    def fetch_text(self, url: str, dest_rel: str) -> str | None:
        """Fetch ``url``, dump verbatim to ``raw/<date>/<dest_rel>``, return text.

        Returns ``None`` on a definitive 404 (an expected-missing source, e.g. a
        season file that does not exist yet) so one bad source never fails the
        whole pipeline (§4). All other failures raise after retries are spent.
        """
        cfg = self._cfg.http

        @retry(
            retry=retry_if_exception_type(_RETRYABLE),
            wait=wait_exponential(
                multiplier=cfg.backoff_base_seconds, max=cfg.backoff_max_seconds
            ),
            stop=stop_after_attempt(cfg.max_retries),
            reraise=True,
        )
        def _do() -> httpx.Response:
            self._throttle()
            resp = self._client.get(url)
            # 404 is a real "not there" — do not retry, signal to caller.
            if resp.status_code == 404:
                return resp
            resp.raise_for_status()
            return resp

        try:
            resp = _do()
        except Exception as exc:  # noqa: BLE001 — logged and re-raised deliberately
            log.error("fetch_failed", url=url, error=str(exc))
            raise

        if resp.status_code == 404:
            log.warning("source_missing", url=url)
            return None

        dest = self.raw_dir / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        log.info("fetched", url=url, bytes=len(resp.content), dest=str(dest))
        return resp.text
