"""Unit tests for Phase 1 & Phase 2 M8 Evaluation Metrics (ECE, IC, Profit Factor, Kelly, Slippage)."""

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from forecasting_agent.evaluation import EvalRequest, evaluate
from forecasting_agent.evaluation.brier import expected_calibration_error
from forecasting_agent.evaluation.mase import information_coefficient
from forecasting_agent.evaluation.sortino import (
    calmar_ratio,
    kelly_fraction,
    max_drawdown,
    profit_factor,
    square_root_slippage,
)

tz = timezone(timedelta(hours=5, minutes=30))


def test_expected_calibration_error() -> None:
    calls = np.array([0.1, 0.2, 0.9, 0.8], dtype=np.float64)
    returns = np.array([-0.01, -0.02, 0.03, 0.04], dtype=np.float64)
    ece = expected_calibration_error(calls, returns)
    assert 0.0 <= ece <= 1.0

    empty_ece = expected_calibration_error(np.array([]), np.array([]))
    assert empty_ece == 0.0


def test_information_coefficient() -> None:
    forecasts = np.array([0.01, 0.02, 0.03, 0.04, 0.05], dtype=np.float64)
    returns = np.array([0.02, 0.04, 0.06, 0.08, 0.10], dtype=np.float64)
    p_ic, r_ic = information_coefficient(forecasts, returns)
    assert pytest.approx(p_ic, 1e-4) == 1.0
    assert pytest.approx(r_ic, 1e-4) == 1.0

    # Constant forecasts
    const_f = np.zeros(5)
    p_ic, r_ic = information_coefficient(const_f, returns)
    assert p_ic == 0.0 and r_ic == 0.0


def test_profit_factor_and_drawdown() -> None:
    period_returns = np.array([0.02, -0.01, 0.03, -0.01], dtype=np.float64)
    pf = profit_factor(period_returns)
    assert pytest.approx(pf, 1e-4) == (0.05 / 0.02)

    mdd = max_drawdown(period_returns)
    assert 0.0 <= mdd <= 1.0

    calmar = calmar_ratio(period_returns)
    assert calmar is not None and calmar > 0.0


def test_kelly_fraction() -> None:
    # 2% expected return with 2% daily volatility (variance = 0.0004)
    # Raw Kelly = 0.02 / 0.0004 = 50.0 -> Clipped to max_leverage 1.0
    f = kelly_fraction(predicted_return=0.02, rolling_vol=0.02, half_kelly=True, max_leverage=1.0)
    assert f == 1.0

    # Negative expected return -> 0.0
    f_neg = kelly_fraction(predicted_return=-0.01, rolling_vol=0.02)
    assert f_neg == 0.0


def test_square_root_slippage() -> None:
    slip = square_root_slippage(
        position_notional=50000.0,
        daily_volume_notional=5000000.0,
        daily_volatility=0.02,
        gamma=0.1,
    )
    assert slip > 0.0
    assert slip < 0.02


def test_pipeline_computes_all_extended_metrics() -> None:
    n = 20
    dt_base = datetime(2026, 8, 1, tzinfo=tz)
    timestamps = [dt_base + timedelta(days=i) for i in range(n)]
    returns = [0.01 * (1 if i % 2 == 0 else -1) for i in range(n)]
    forecasts = [0.005 * (1 if i % 2 == 0 else -1) for i in range(n)]
    calls = [0.55 if f > 0 else 0.45 for f in forecasts]
    pos = [50000.0 if c > 0.5 else 0.0 for c in calls]
    trade_side = ["buy" if p > 0 else "hold" for p in pos]

    req = EvalRequest(
        returns=returns,
        forecasts=forecasts,
        calls=calls,
        timestamps=timestamps,
        as_of=timestamps[-1],
        segment="EQUITY_FUTURES",
        position_notional=pos,
        trade_side=trade_side,
        capital=100000.0,
    )

    res = evaluate(req, min_train_size=5, n_splits=2)
    assert res.verdict.status == "VALID"
    l1_scores = [s for s in res.layers if s.layer == 1]
    l2_scores = [s for s in res.layers if s.layer == 2]
    l3_scores = [s for s in res.layers if s.layer == 3]

    assert len(l1_scores) > 0
    assert l1_scores[0].rank_ic is not None
    assert l1_scores[0].pearson_ic is not None

    assert len(l2_scores) > 0
    assert l2_scores[0].ece is not None

    assert len(l3_scores) > 0
    assert l3_scores[0].profit_factor is not None
    assert l3_scores[0].max_drawdown is not None
