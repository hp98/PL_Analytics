"""Walk-forward backtest (§6 gate).

For each of the last three complete seasons, the minutes model is trained on all
strictly-earlier seasons and the statistical stages use only as-of data. The
model's rank correlation against actual points is compared with the baselines;
the verdict decides whether projections may ship.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import structlog
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error

from pipeline.config import Config
from pipeline.model.baselines import add_baselines
from pipeline.model.dataset import build_dataset
from pipeline.model.minutes import predict_minutes, train_minutes_model
from pipeline.model.projection import calibrate, project

log = structlog.get_logger(__name__)

PREDICTORS = ["xp", "last6_avg", "last3_avg", "season_ppg"]


@dataclass
class BacktestResult:
    verdict: str                       # "model" or "baseline:<name>"
    ship_model: bool
    metrics: dict[str, dict[str, float]]
    n_rows: int
    n_pool: int
    seasons: list[str]
    notes: list[str] = field(default_factory=list)


def _season_rank(cfg: Config) -> dict[str, int]:
    return {s: i for i, s in enumerate(cfg.player_gameweek_seasons)}


def _mean_per_gw_spearman(df: pd.DataFrame, pred: str) -> float:
    vals: list[float] = []
    for _, grp in df.groupby(["season", "gw"]):
        if len(grp) < 5:
            continue
        a, b = grp[pred].to_numpy(), grp["total_points"].to_numpy()
        if np.std(a) == 0 or np.std(b) == 0:
            continue
        rho = spearmanr(a, b).correlation
        if not np.isnan(rho):
            vals.append(float(rho))
    return float(np.mean(vals)) if vals else float("nan")


def run_backtest(cfg: Config) -> tuple[BacktestResult, pd.DataFrame]:
    seasons = list(cfg.raw["backtest"]["seasons"])
    thr = float(cfg.raw["backtest"]["relevant_min_play_prob"])
    rank = _season_rank(cfg)

    log.info("backtest_build_dataset")
    df = build_dataset(cfg)
    df = add_baselines(df)
    calib = calibrate(df)

    preds: list[pd.DataFrame] = []
    for season in seasons:
        train = df[df["season"].map(rank) < rank[season]]
        test = df[df["season"] == season].copy()
        log.info("backtest_season", season=season, train_rows=len(train), test_rows=len(test))
        model = train_minutes_model(train)
        mins = predict_minutes(model, test)
        test = pd.concat([test, mins], axis=1)
        preds.append(project(test, calib, cfg))

    allpred = pd.concat(preds, ignore_index=True)
    for c in PREDICTORS:
        allpred[c] = allpred[c].astype(float).fillna(0.0)

    # Relevant-player pool: likely to play OR actually played.
    pool = allpred[((allpred["p_short"] + allpred["p_long"]) >= thr) | (allpred["minutes"] > 0)]

    metrics: dict[str, dict[str, float]] = {}
    for pred in PREDICTORS:
        metrics[pred] = {
            "mae": float(mean_absolute_error(pool["total_points"], pool[pred])),
            "spearman_pooled": float(spearmanr(pool[pred], pool["total_points"]).correlation),
            "spearman_per_gw": _mean_per_gw_spearman(pool, pred),
        }

    model_score = metrics["xp"]["spearman_per_gw"]
    baseline_scores = {b: metrics[b]["spearman_per_gw"] for b in PREDICTORS if b != "xp"}
    best_baseline = max(baseline_scores, key=lambda k: baseline_scores[k])
    ship_model = all(model_score > s for s in baseline_scores.values())

    notes = [
        "FPL `ep_next` is live-only and absent from the historical archive, so it "
        "cannot be a historical baseline; last6_avg / last3_avg / season_ppg stand in.",
        "Primary gate metric is mean per-gameweek Spearman over the relevant-player pool.",
    ]
    result = BacktestResult(
        verdict="model" if ship_model else f"baseline:{best_baseline}",
        ship_model=ship_model,
        metrics=metrics,
        n_rows=len(allpred),
        n_pool=len(pool),
        seasons=seasons,
        notes=notes,
    )
    return result, allpred


def write_report(cfg: Config, result: BacktestResult) -> Path:
    reports = cfg.paths.warehouse.parent.parent / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).isoformat()

    payload: dict[str, Any] = {
        "generated_at": stamp,
        "seasons": result.seasons,
        "verdict": result.verdict,
        "ship_model": result.ship_model,
        "n_rows": result.n_rows,
        "n_pool": result.n_pool,
        "metrics": result.metrics,
        "notes": result.notes,
    }
    (reports / "backtest.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def row(name: str) -> str:
        m = result.metrics[name]
        return (
            f"| {name} | {m['spearman_per_gw']:.4f} | {m['spearman_pooled']:.4f} "
            f"| {m['mae']:.3f} |"
        )

    verdict_line = (
        "✅ **The model beats every baseline on rank correlation — projections may ship.**"
        if result.ship_model
        else f"⚠️ **The model does NOT beat all baselines. Ship the best baseline "
        f"(`{result.verdict.split(':')[1]}`) instead, per the §6 gate.**"
    )
    lines = [
        "# Projection backtest",
        "",
        f"_Generated {stamp}_",
        "",
        f"Walk-forward across {', '.join(result.seasons)}. Minutes model trained on "
        "strictly-earlier seasons; statistical stages use as-of data only. Evaluated over "
        f"the relevant-player pool ({result.n_pool:,} of {result.n_rows:,} player-gameweeks).",
        "",
        verdict_line,
        "",
        "| predictor | Spearman (per-GW) | Spearman (pooled) | MAE |",
        "|---|---|---|---|",
        row("xp"),
        row("last6_avg"),
        row("last3_avg"),
        row("season_ppg"),
        "",
        "## Notes",
        *[f"- {n}" for n in result.notes],
        "",
    ]
    md = reports / "backtest.md"
    md.write_text("\n".join(lines), encoding="utf-8")
    return md
