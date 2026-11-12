"""Stage 1 — minutes model. A LightGBM 3-class classifier predicting, per
player-fixture, P(0 min) / P(1-59 min) / P(60+ min). This is the single biggest
driver of projection accuracy (§6), so it gets the one trained ML model; the
remaining stages are statistical.
"""

from __future__ import annotations

import lightgbm as lgb
import numpy as np
import pandas as pd

MINUTES_FEATURES = [
    "start_rate5",
    "min_mean5",
    "p60_rate5",
    "min_last1",
    "played_last1",
    "transfers_mom",
    "games_todate",
    "days_since_last",
    "value",
    "position_code",
]

_POSITION_CODE = {"GKP": 0, "DEF": 1, "MID": 2, "FWD": 3, "MNG": 4}


def add_position_code(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["position_code"] = df["position"].map(_POSITION_CODE).astype("float64")
    return df


def train_minutes_model(train: pd.DataFrame, seed: int = 42) -> lgb.LGBMClassifier:
    """Fit the 3-class minutes classifier on an as-of feature frame."""
    train = add_position_code(train)
    x = train[MINUTES_FEATURES]
    y = train["minutes_class"].astype(int)
    model = lgb.LGBMClassifier(
        objective="multiclass",
        num_class=3,
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        min_child_samples=100,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=seed,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(x, y)
    return model


def predict_minutes(model: lgb.LGBMClassifier, df: pd.DataFrame) -> pd.DataFrame:
    """Return p_dnp / p_short / p_long columns aligned to df's index."""
    df = add_position_code(df)
    proba = np.asarray(model.predict_proba(df[MINUTES_FEATURES]))
    classes = list(model.classes_)
    out = pd.DataFrame(index=df.index)
    out["p_dnp"] = proba[:, classes.index(0)] if 0 in classes else 0.0
    out["p_short"] = proba[:, classes.index(1)] if 1 in classes else 0.0
    out["p_long"] = proba[:, classes.index(2)] if 2 in classes else 0.0
    # Renormalise defensively.
    total = out[["p_dnp", "p_short", "p_long"]].sum(axis=1).replace(0, np.nan)
    for c in ("p_dnp", "p_short", "p_long"):
        out[c] = (out[c] / total).fillna(1 / 3)
    return out
