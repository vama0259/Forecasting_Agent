"""Layer 1 MASE evaluation metric with train-fold Hyndman denominator and zero-forecast baseline."""

import math
import warnings

import numpy as np
from numpy.typing import NDArray

from forecasting_agent.evaluation.errors import DegenerateBaselineError


def train_baseline(y_train: NDArray[np.float64]) -> float:
    """Takes train returns array; returns Hyndman's mean absolute first difference without raising."""
    diffs = np.abs(np.diff(y_train))
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
