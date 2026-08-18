"""Layer 2 Brier score evaluation metric and 10-bin calibration table."""

import numpy as np
from numpy.typing import NDArray
from sklearn.metrics import brier_score_loss

from forecasting_agent.evaluation.types import CalibrationBin

BIN_EDGES: NDArray[np.float64] = np.linspace(0.0, 1.0, 11)


def bull_labels(returns: NDArray[np.float64]) -> NDArray[np.int_]:
    """Takes returns array; returns binary indicator array where positive returns are 1 and non-positive are 0."""
    return np.where(returns > 0.0, 1, 0)


def brier(calls: NDArray[np.float64], returns: NDArray[np.float64]) -> float:
    """Takes calls and returns arrays; returns half-scaled Brier score loss."""
    kwargs = {"scale_by_half": True}
    return float(brier_score_loss(bull_labels(returns), calls, **kwargs))


def calibration_bins(calls: NDArray[np.float64], returns: NDArray[np.float64]) -> list[CalibrationBin]:
    """Takes calls and returns arrays; returns ten-bin calibration statistics table."""
    labels = bull_labels(returns)
    bin_indices = np.digitize(calls, BIN_EDGES[1:-1])
    bins: list[CalibrationBin] = []
    for i in range(10):
        mask = bin_indices == i
        count = int(np.sum(mask))
        if count == 0:
            bins.append(CalibrationBin(count=0, mean_predicted=0.0, mean_observed=0.0))
        else:
            mean_pred = float(np.mean(calls[mask]))
            mean_obs = float(np.mean(labels[mask]))
            bins.append(CalibrationBin(count=count, mean_predicted=mean_pred, mean_observed=mean_obs))
    return bins
