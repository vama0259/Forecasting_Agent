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
    slippage_rates: Sequence[float] | None = None,
) -> NDArray[np.float64]:
    """Takes return, notional, side, timestamp sequences and fee schedule; returns net period returns."""
    n = len(returns)
    period_returns = np.empty(n, dtype=np.float64)
    for i in range(n):
        slip_rate = float(slippage_rates[i]) if slippage_rates is not None and i < len(slippage_rates) else 0.0
        exposure_sign = 1.0 if trade_side[i] == "buy" else -1.0 if trade_side[i] == "sell" else 0.0
        effective_return = exposure_sign * returns[i]
        if exposure_sign != 0.0:
            effective_return -= slip_rate
        fee = schedule.total_fee(float(position_notional[i]), trade_side[i], segment, timestamps[i])
        period_returns[i] = (effective_return * position_notional[i] - fee) / capital
    return period_returns


def downside_deviation(period_returns: NDArray[np.float64]) -> float:
    """Takes period returns array; returns root-mean-square of negative returns with zero MAR."""
    return float(np.sqrt(np.mean(np.minimum(period_returns, 0.0) ** 2)))


def sortino(period_returns: NDArray[np.float64]) -> SortinoResult:
    """Takes period returns array; returns Sortino ratio result with conditional annualization."""
    dd = downside_deviation(period_returns)
    if dd <= 0.0:
        return SortinoResult(None, False, "no_downside_observations")
    if len(period_returns) >= MIN_OBS_FOR_ANNUALIZATION:
        val = (float(np.mean(period_returns)) * TRADING_DAYS_PER_YEAR) / (dd * float(np.sqrt(TRADING_DAYS_PER_YEAR)))
        return SortinoResult(val, True, None)
    val = float(np.mean(period_returns)) / dd
    return SortinoResult(val, False, None)


def profit_factor(period_returns: NDArray[np.float64]) -> float:
    """Takes period returns array; returns ratio of gross profits to gross losses."""
    gains = float(np.sum(period_returns[period_returns > 0.0]))
    losses = float(np.sum(np.abs(period_returns[period_returns < 0.0])))
    if losses <= 1e-12:
        return float("inf") if gains > 0.0 else 0.0
    return gains / losses


def max_drawdown(period_returns: NDArray[np.float64]) -> float:
    """Takes period returns array; returns maximum peak-to-trough drawdown on compounding equity curve."""
    if len(period_returns) == 0:
        return 0.0
    equity = np.cumprod(1.0 + period_returns)
    peak = np.maximum.accumulate(equity)
    drawdowns = (peak - equity) / peak
    return float(np.max(drawdowns))


def calmar_ratio(period_returns: NDArray[np.float64]) -> float | None:
    """Takes period returns array; returns annualized return over maximum drawdown."""
    mdd = max_drawdown(period_returns)
    if mdd <= 1e-6:
        return None
    annualized_return = float(np.mean(period_returns)) * TRADING_DAYS_PER_YEAR
    return annualized_return / mdd


def kelly_fraction(
    predicted_return: float,
    rolling_vol: float,
    half_kelly: bool = True,
    max_leverage: float = 1.0,
) -> float:
    """Computes fractional Kelly optimal position sizing bounded by max leverage."""
    if rolling_vol <= 1e-6 or predicted_return <= 0.0:
        return 0.0
    variance = rolling_vol**2
    raw_kelly = predicted_return / variance
    fraction = raw_kelly * 0.5 if half_kelly else raw_kelly
    return float(np.clip(fraction, 0.0, max_leverage))


def square_root_slippage(
    position_notional: float,
    daily_volume_notional: float,
    daily_volatility: float,
    gamma: float = 0.1,
) -> float:
    """Computes square-root market impact slippage rate based on trade size and volume."""
    if position_notional <= 0.0 or daily_volume_notional <= 0.0:
        return 0.0
    participation = position_notional / max(daily_volume_notional, 1.0)
    slippage = gamma * daily_volatility * float(np.sqrt(participation))
    return float(slippage)
