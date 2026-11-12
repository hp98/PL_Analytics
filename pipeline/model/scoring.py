"""FPL scoring rules (fixed rules, not modelling assumptions).

Kept in one place so every stage converts events to points identically.
"""

from __future__ import annotations

# Points per goal by position.
GOAL_POINTS: dict[str, int] = {"GKP": 6, "DEF": 6, "MID": 5, "FWD": 4, "MNG": 0}

# Clean-sheet points by position (GKP/DEF 4, MID 1, FWD 0).
CLEAN_SHEET_POINTS: dict[str, int] = {"GKP": 4, "DEF": 4, "MID": 1, "FWD": 0, "MNG": 0}

ASSIST_POINTS = 3

# Positions that concede a -1 penalty per 2 goals conceded, and earn CS/save pts.
DEFENSIVE_POSITIONS = frozenset({"GKP", "DEF"})

SAVE_POINTS_PER = 3  # 1 point per 3 saves (GKP)
YELLOW_CARD_POINTS = -1
RED_CARD_POINTS = -3


def appearance_points(prob_1_59: float, prob_60_plus: float) -> float:
    """Expected appearance points: 1 for a cameo, 2 for 60+ minutes."""
    return prob_1_59 * 1.0 + prob_60_plus * 2.0
