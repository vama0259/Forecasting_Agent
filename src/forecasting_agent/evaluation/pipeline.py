from typing import Literal

import numpy as np

from forecasting_agent.evaluation.brier import (
    brier,
    brier_decomposition,
    calibration_bins,
    direction_hit_rate,
    expected_calibration_error,
)
from forecasting_agent.evaluation.fees import IndianFeeSchedule, TradeSide
from forecasting_agent.evaluation.gate import run_gate
from forecasting_agent.evaluation.mase import information_coefficient, mase, zero_forecast_mase
from forecasting_agent.evaluation.sortino import (
    calmar_ratio,
    cost_adjusted_period_returns,
    max_drawdown,
    profit_factor,
    sortino,
)
from forecasting_agent.evaluation.types import EvalRequest, EvalResult, LayerMean, LayerScore
from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def evaluate(
    request: EvalRequest,
    *,
    horizon: int = 1,
    min_train_size: int = 3,
    n_splits: int = 5,
    gap: int | None = None,
) -> EvalResult:
    """Takes evaluation request and splitter options; returns EvalResult with verdict, layer scores, and layer means."""
    splitter = PurgedWalkForward(n_splits=n_splits, gap=gap, horizon=horizon, min_train_size=min_train_size)
    verdict = run_gate(request, splitter)

    if verdict.status == "INVALID":
        return EvalResult(verdict=verdict, layers=[], layer_means={})

    returns_arr = np.asarray(request.returns, dtype=np.float64)
    forecasts_arr = np.asarray(request.forecasts, dtype=np.float64)
    calls_arr = np.asarray(request.calls, dtype=np.float64)
    notional_arr = np.asarray(request.position_notional, dtype=np.float64)
    schedule = IndianFeeSchedule()
    layers: list[LayerScore] = []

    for fold in verdict.folds:
        train_idx = list(fold.train_idx)
        test_idx = list(fold.test_idx)
        fn = fold.fold_number
        y_train = returns_arr[train_idx]
        y_test = returns_arr[test_idx]

        l1_forecast = forecasts_arr[test_idx]
        l1_val = mase(y_train, y_test, l1_forecast)
        l1_zero = zero_forecast_mase(y_train, y_test)
        l1_beats_zero = l1_val < l1_zero
        p_ic, r_ic = information_coefficient(l1_forecast, y_test)
        layers.append(
            LayerScore(
                layer=1,
                fold_number=fn,
                value=l1_val,
                zero_forecast_mase=l1_zero,
                beats_zero=l1_beats_zero,
                pearson_ic=p_ic,
                rank_ic=r_ic,
            )
        )

        l2_calls = calls_arr[test_idx]
        l2_returns = y_test
        l2_val = brier(l2_calls, l2_returns)
        l2_bins = calibration_bins(l2_calls, l2_returns)
        l2_ece = expected_calibration_error(l2_calls, l2_returns)
        layers.append(
            LayerScore(
                layer=2,
                fold_number=fn,
                value=l2_val,
                calibration_bins=l2_bins,
                ece=l2_ece,
            )
        )

        l3_sides: list[TradeSide] = [request.trade_side[idx] for idx in test_idx]
        l3_ts = [request.timestamps[idx] for idx in test_idx]
        l3_notional = notional_arr[test_idx]
        l3_returns = y_test
        period_returns = cost_adjusted_period_returns(
            returns=l3_returns,
            position_notional=l3_notional,
            trade_side=l3_sides,
            timestamps=l3_ts,
            segment=request.segment,
            capital=request.capital,
            schedule=schedule,
        )
        sortino_res = sortino(period_returns)
        l3_pf = profit_factor(period_returns)
        l3_mdd = max_drawdown(period_returns)
        l3_calmar = calmar_ratio(period_returns)
        layers.append(
            LayerScore(
                layer=3,
                fold_number=fn,
                value=sortino_res.value,
                annualized=sortino_res.annualized,
                note=sortino_res.note,
                profit_factor=l3_pf,
                max_drawdown=l3_mdd,
                calmar_ratio=l3_calmar,
            )
        )

    layer_means: dict[Literal[1, 2, 3], LayerMean] = {}
    for layer_id in (1, 2, 3):
        vals = [s.value for s in layers if s.layer == layer_id and s.value is not None]
        if len(vals) >= 2:
            layer_means[layer_id] = LayerMean(mean=float(np.mean(vals)), n_folds=len(vals))

    # Pool every surviving fold's test observations before computing the directional and
    # decomposition diagnostics -- see the note on EvalResult for why these cannot be fold-averaged.
    pooled_idx = [idx for fold in verdict.folds for idx in fold.test_idx]
    pooled_calls = calls_arr[pooled_idx]
    pooled_returns = returns_arr[pooled_idx]

    return EvalResult(
        verdict=verdict,
        layers=layers,
        layer_means=layer_means,
        direction=direction_hit_rate(pooled_calls, pooled_returns),
        brier_split=brier_decomposition(pooled_calls, pooled_returns),
    )
