import math
from collections.abc import Sequence
from datetime import datetime
from typing import NamedTuple

import numpy as np
from numpy.typing import NDArray

from forecasting_agent.evaluation.fees import IndianFeeSchedule, Segment, TradeSide

TRADING_DAYS_PER_YEAR: int = 252
MIN_OBS_FOR_ANNUALIZATION: int = 20


class SortinoResult(NamedTuple):
    """Named tuple holding Sortino ratio score, annualization status, and optional diagnostic note."""

    value: float | None
    annualized: bool
    note: str | None


def cost_adjusted_period_returns(
    returns: NDArray[np.float64],
    position_notional: NDArray[np.float64],
    trade_side: Sequence[TradeSide],
    timestamps: Sequence[datetime],
    segment: Segment,
    capital: float,
    schedule: IndianFeeSchedule,
) -> NDArray[np.float64]:
    """Takes return, notional, side, timestamp sequences with capital and fee schedule; returns net period returns."""
    n = len(returns)
    period_returns = np.empty(n, dtype=np.float64)
    for i in range(n):
        fee = schedule.total_fee(float(position_notional[i]), trade_side[i], segment, timestamps[i])
        period_returns[i] = (returns[i] * position_notional[i] - fee) / capital
    return period_returns


def downside_deviation(period_returns: NDArray[np.float64]) -> float:
    """Takes period returns array; returns root-mean-square of negative returns with zero MAR."""
    return float(np.sqrt(np.mean(np.minimum(period_returns, 0.0) ** 2)))


def sortino(period_returns: NDArray[np.float64]) -> SortinoResult:
    """Takes period returns array; returns Sortino ratio result with conditional annualization."""
    dd = downside_deviation(period_returns)
    if math.isclose(dd, 0.0, abs_tol=1e-15):
        return SortinoResult(None, False, "no_downside_observations")
    if len(period_returns) >= MIN_OBS_FOR_ANNUALIZATION:
        val = (float(np.mean(period_returns)) * TRADING_DAYS_PER_YEAR) / (dd * float(np.sqrt(TRADING_DAYS_PER_YEAR)))
        return SortinoResult(val, True, None)
    val = float(np.mean(period_returns)) / dd
    return SortinoResult(val, False, None)
