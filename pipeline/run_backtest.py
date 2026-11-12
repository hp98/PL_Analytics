"""CLI: run the walk-forward projection backtest and write the report.

    uv run python -m pipeline.run_backtest
"""

from __future__ import annotations

import sys

import structlog

from pipeline.config import load_config
from pipeline.logging_setup import configure_json_logging
from pipeline.model.backtest import run_backtest, write_report


def main() -> int:
    configure_json_logging()
    log = structlog.get_logger("run_backtest")
    cfg = load_config()

    result, _preds = run_backtest(cfg)
    path = write_report(cfg, result)

    log.info(
        "backtest_done",
        verdict=result.verdict,
        ship_model=result.ship_model,
        model_spearman=result.metrics["xp"]["spearman_per_gw"],
        report=str(path),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
