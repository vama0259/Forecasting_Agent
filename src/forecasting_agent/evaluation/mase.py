"""Layer 1 MASE evaluation metric with train-fold Hyndman denominator and zero-forecast baseline."""

import math
import warnings

import numpy as np
from numpy.typing import NDArray

from forecasting_agent.evaluation.errors import DegenerateBaselineError


def train_baseline(y_train: NDArray[np.float64]) -> float:
    """Takes train returns array; returns Hyndman's mean absolute first difference without raising."""
    diffs = np.abs(np.diff(y_train))
    if len(diffs) == 0:
        return float("nan")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return float(np.mean(diffs))


def naive_forecast(y_train: NDArray[np.float64], y_test: NDArray[np.float64]) -> NDArray[np.float64]:
    """Takes train and test returns arrays; returns last-observed-carried-forward naive forecast."""
    forecast = np.empty(len(y_test), dtype=np.float64)
    forecast[0] = y_train[-1]
    if len(y_test) > 1:
        forecast[1:] = y_test[:-1]
    return forecast


def mase(y_train: NDArray[np.float64], y_test: NDArray[np.float64], forecast: NDArray[np.float64]) -> float:
    """Takes train, test, and forecast arrays; returns mean absolute scaled error or raises on degenerate baseline."""
    d = train_baseline(y_train)
    if (not math.isfinite(d)) or d <= 0.0:
        raise DegenerateBaselineError(f"mean(|Δy_train|) = {d}")
    return float(np.mean(np.abs(y_test - forecast)) / d)


def zero_forecast_mase(y_train: NDArray[np.float64], y_test: NDArray[np.float64]) -> float:
    """Takes train and test returns arrays; returns MASE score against an all-zero forecast series."""
    return mase(y_train, y_test, np.zeros_like(y_test))


def information_coefficient(forecasts: NDArray[np.float64], returns: NDArray[np.float64]) -> tuple[float, float]:
    """Takes forecasts and returns arrays; returns (pearson_ic, rank_ic) correlation coefficients."""
    n = len(forecasts)
    if n < 2:
        return 0.0, 0.0

    std_f = float(np.std(forecasts))
    std_r = float(np.std(returns))
    if std_f <= 1e-12 or std_r <= 1e-12:
        return 0.0, 0.0

    # Pearson Linear IC
    pearson = float(np.corrcoef(forecasts, returns)[0, 1])
    if not math.isfinite(pearson):
        pearson = 0.0

    # Spearman Rank IC
    rank_f = np.argsort(np.argsort(forecasts)).astype(np.float64)
    rank_r = np.argsort(np.argsort(returns)).astype(np.float64)
    rank_ic = float(np.corrcoef(rank_f, rank_r)[0, 1])
    if not math.isfinite(rank_ic):
        rank_ic = 0.0

    return pearson, rank_ic
