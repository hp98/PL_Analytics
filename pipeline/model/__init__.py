"""Projection model (M4): decomposed xP + walk-forward backtest.

Stages (brief §6): minutes -> attacking returns -> clean sheets -> bonus ->
peripherals, assembled as xP = Σ P(minutes scenario) × E(points | scenario).
"""
