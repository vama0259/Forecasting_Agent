"""Tests for Layer 3 — exposure-weighted cost-adjusted period returns and the Sortino ratio."""

from datetime import UTC, datetime

import numpy as np
import pytest

from forecasting_agent.evaluation.fees import IndianFeeSchedule
from forecasting_agent.evaluation.sortino import (
    MIN_OBS_FOR_ANNUALIZATION,
    TRADING_DAYS_PER_YEAR,
    cost_adjusted_period_returns,
    downside_deviation,
    sortino,
)

TRADE_DATE = datetime(2026, 8, 14, tzinfo=UTC)


def test_constants_are_the_named_module_values() -> None:
    assert TRADING_DAYS_PER_YEAR == 252
    assert MIN_OBS_FOR_ANNUALIZATION == 20


def test_short_position_profits_when_underlying_falls() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([-0.01]),
        position_notional=np.array([10_000.0]),
        trade_side=["sell"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == pytest.approx(7.428594e-05, rel=1e-6)


def test_short_position_loses_when_underlying_rises() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([0.01]),
        position_notional=np.array([10_000.0]),
        trade_side=["sell"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == pytest.approx(-0.00012571406, rel=1e-6)


def test_flat_hold_period_absorbs_no_market_loss() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([-0.05]),
        position_notional=np.array([0.0]),
        trade_side=["hold"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == 0.0


def test_hold_with_carried_notional_has_no_market_exposure() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([-0.05]),
        position_notional=np.array([10_000.0]),
        trade_side=["hold"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == 0.0


@pytest.mark.parametrize("side", ["buy", "sell"])
def test_slippage_is_adverse_for_both_long_and_short_positions(side: str) -> None:
    without_slippage = cost_adjusted_period_returns(
        returns=np.array([0.01]),
        position_notional=np.array([10_000.0]),
        trade_side=[side],  # type: ignore[list-item]
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    with_slippage = cost_adjusted_period_returns(
        returns=np.array([0.01]),
        position_notional=np.array([10_000.0]),
        trade_side=[side],  # type: ignore[list-item]
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
        slippage_rates=[0.001],
    )
    assert with_slippage[0] < without_slippage[0]


def test_downside_deviation_divides_by_n_not_by_the_negative_count() -> None:
    series = np.array([0.02, -0.01, 0.03, -0.02, 0.01])
    assert downside_deviation(series) == pytest.approx(0.01, rel=1e-12)
    assert downside_deviation(series) != pytest.approx(0.015811388300841896, rel=1e-9)


def test_sortino_on_a_hand_computed_short_series_is_not_annualized() -> None:
    series = np.array([0.02, -0.01, 0.03, -0.02, 0.01])
    result = sortino(series)
    assert result.annualized is False
    assert result.note is None
    assert result.value == pytest.approx(0.6, rel=1e-12)


def test_sortino_annualizes_at_or_above_the_observation_floor() -> None:
    series = np.tile(np.array([0.02, -0.01, 0.03, -0.02, 0.01]), 4)
    assert len(series) == 20
    result = sortino(series)
    assert result.annualized is True
    assert result.value == pytest.approx(0.6 * np.sqrt(TRADING_DAYS_PER_YEAR), rel=1e-12)


def test_annualized_form_agrees_with_the_bare_sqrt_scaled_ratio() -> None:
    series = np.tile(np.array([0.02, -0.01, 0.03, -0.02, 0.01]), 4)
    numerator_denominator = (float(series.mean()) * TRADING_DAYS_PER_YEAR) / (
        downside_deviation(series) * float(np.sqrt(TRADING_DAYS_PER_YEAR))
    )
    value = sortino(series).value
    assert value is not None
    assert value == pytest.approx(numerator_denominator, rel=1e-12)


def test_no_losing_period_reports_none_with_a_note_not_infinity() -> None:
    result = sortino(np.array([0.01, 0.02, 0.0, 0.03]))
    assert result.value is None
    assert result.note == "no_downside_observations"
    assert result.annualized is False


def test_all_zero_series_reports_no_downside_observations() -> None:
    result = sortino(np.zeros(30))
    assert result.value is None
    assert result.note == "no_downside_observations"


def test_target_return_is_zero_so_small_positive_returns_are_not_downside() -> None:
    assert downside_deviation(np.array([0.0001, 0.0002, 0.0003])) == 0.0


def test_fees_reduce_the_period_return_relative_to_a_free_schedule() -> None:
    kwargs = {
        "returns": np.array([0.01]),
        "position_notional": np.array([10_000.0]),
        "trade_side": ["sell"],
        "timestamps": [TRADE_DATE],
        "segment": "EQUITY_DELIVERY",
        "capital": 1_000_000.0,
    }
    charged = cost_adjusted_period_returns(schedule=IndianFeeSchedule(), **kwargs)  # type: ignore[arg-type]
    brokered = cost_adjusted_period_returns(schedule=IndianFeeSchedule(brokerage=50.0), **kwargs)  # type: ignore[arg-type]
    assert brokered[0] < charged[0]
