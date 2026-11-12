"""Structured (JSON) logging configuration shared by the pipeline CLIs."""

from __future__ import annotations

import logging

import structlog


def configure_json_logging(level: int = logging.INFO) -> None:
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
    )
