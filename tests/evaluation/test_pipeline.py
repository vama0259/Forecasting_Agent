"""End-to-end tests for evaluate() — gate short-circuit, per-fold scoring, and layer_means floors."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from forecasting_agent.evaluation import EvalRequest, EvalResult, GateVerdict, evaluate


def _request(
    returns: list[float],
    *,
    as_of_offset_days: int = 3650,
    sides: list[str] | None = None,
    notional: list[float] | None = None,
    forecasts: list[float] | None = None,
) -> EvalRequest:
    """Takes a return series plus optional sides/notional/forecasts; returns a coherent EvalRequest over it."""
    n = len(returns)
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return EvalRequest(
        returns=returns,
        forecasts=forecasts if forecasts is not None else [0.0] * n,
        calls=[0.6 if r > 0 else 0.4 for r in returns],
        timestamps=[start + timedelta(days=i) for i in range(n)],
        as_of=start + timedelta(days=as_of_offset_days),
        segment="EQUITY_DELIVERY",
        position_notional=notional if notional is not None else [10_000.0] * n,
        trade_side=sides if sides is not None else ["hold"] * n,  # type: ignore[arg-type]
        capital=1_000_000.0,
    )


def _varied(n: int) -> list[float]:
    """Takes a length; returns a deterministic non-constant return series of that length."""
    return [float(np.sin(i) * 0.01) for i in range(n)]


def test_public_surface_exports_exactly_four_names() -> None:
    import forecasting_agent.evaluation as package

    assert set(package.__all__) == {"evaluate", "EvalRequest", "EvalResult", "GateVerdict"}


def test_healthy_run_is_valid_and_scores_every_surviving_fold() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    assert isinstance(result, EvalResult)
    assert result.verdict.status == "VALID"
    assert len(result.verdict.folds) == 3
    assert {score.layer for score in result.layers} == {1, 2, 3}
    assert len([s for s in result.layers if s.layer == 1]) == 3


def test_scores_are_per_fold_not_one_whole_series_score() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    layer_one_folds = sorted(s.fold_number for s in result.layers if s.layer == 1)
    assert layer_one_folds == [0, 1, 2]
    assert len({s.value for s in result.layers if s.layer == 1}) > 1


def _layer_one_means(returns: list[float], forecasts: list[float]) -> list[float | None]:
    """Takes a return series and a forecast series; returns the per-fold layer-1 values scored over them."""
    result = evaluate(_request(returns, forecasts=forecasts), n_splits=3, gap=2, horizon=1)
    return [s.value for s in result.layers if s.layer == 1]


def test_layer_one_scores_the_submitted_forecast_not_a_fixed_baseline() -> None:
    """A perfect and a catastrophic forecast must not receive the same layer-1 score."""
    returns = _varied(120)
    perfect = _layer_one_means(returns, list(returns))
    terrible = _layer_one_means(returns, [-r * 100 for r in returns])
    assert perfect != terrible


def test_layer_one_scores_zero_for_a_perfect_forecast() -> None:
    returns = _varied(120)
    assert _layer_one_means(returns, list(returns)) == [0.0, 0.0, 0.0]


def test_layer_one_beats_zero_flag_reflects_the_submitted_forecast() -> None:
    """beats_zero compares the model against the zero forecast, so a perfect model must set it True."""
    returns = _varied(120)
    result = evaluate(_request(returns, forecasts=list(returns)), n_splits=3, gap=2, horizon=1)
    assert all(s.beats_zero for s in result.layers if s.layer == 1)


def test_invalid_run_returns_an_evalresult_with_empty_layers_and_means() -> None:
    result = evaluate(_request(_varied(120), as_of_offset_days=10), n_splits=3, gap=2, horizon=1)
    assert isinstance(result, EvalResult)
    assert isinstance(result.verdict, GateVerdict)
    assert result.verdict.status == "INVALID"
    assert list(result.layers) == []
    assert result.layer_means == {}


def test_invalid_run_never_calls_the_metric_layers(monkeypatch: pytest.MonkeyPatch) -> None:
    import forecasting_agent.evaluation.pipeline as pipeline_module

    def _explode(*_args: object, **_kwargs: object) -> float:
        raise AssertionError("Layers 1-3 must not run when the gate is INVALID")

    for name in ("mase", "zero_forecast_mase", "brier", "calibration_bins", "sortino"):
        monkeypatch.setattr(pipeline_module, name, _explode, raising=False)
    result = evaluate(_request(_varied(120), as_of_offset_days=10), n_splits=3, gap=2, horizon=1)
    assert result.verdict.status == "INVALID"


def test_layer_one_carries_the_zero_forecast_fields() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    layer_one = [s for s in result.layers if s.layer == 1]
    for score in layer_one:
        assert score.zero_forecast_mase is not None
        assert score.beats_zero is not None
        assert score.calibration_bins is None
        assert score.annualized is None


def test_layer_two_carries_all_ten_calibration_bins() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    for score in (s for s in result.layers if s.layer == 2):
        assert score.calibration_bins is not None
        assert len(score.calibration_bins) == 10
        assert score.zero_forecast_mase is None


def test_layer_three_carries_the_annualized_flag() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    for score in (s for s in result.layers if s.layer == 3):
        assert score.annualized is not None
        assert score.zero_forecast_mase is None


def test_layer_means_present_with_n_folds_for_layers_one_and_two() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    valid_folds = len(result.verdict.folds)
    assert valid_folds >= 2
    assert result.layer_means[1].n_folds == valid_folds
    assert result.layer_means[2].n_folds == valid_folds
    assert result.layer_means[1].mean == pytest.approx(
        float(np.mean([s.value for s in result.layers if s.layer == 1 and s.value is not None]))
    )


def test_layer_three_mean_absent_when_fewer_than_two_folds_have_downside() -> None:
    n = 120
    sides = ["hold"] * n
    notional = [0.0] * n
    result = evaluate(_request(_varied(n), sides=sides, notional=notional), n_splits=3, gap=2, horizon=1)
    assert result.verdict.status == "VALID"
    assert all(s.note == "no_downside_observations" for s in result.layers if s.layer == 3)
    assert 3 not in result.layer_means
    assert 1 in result.layer_means


def test_every_layerscore_fold_number_joins_against_surviving_folds() -> None:
    result = evaluate(_request(_varied(20)), n_splits=5, gap=4, horizon=1, min_train_size=3)
    survivors = {f.fold_number for f in result.verdict.folds}
    skipped = {s.fold_number for s in result.verdict.skipped}
    assert {s.fold_number for s in result.layers} <= survivors
    assert survivors & skipped == set()


def test_gap_defaults_to_horizon_when_omitted() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, horizon=1)
    assert result.verdict.status == "VALID"


def test_parameter_bounds_surface_as_value_errors() -> None:
    request = _request(_varied(120))
    with pytest.raises(ValueError, match="min_train_size"):
        evaluate(request, min_train_size=2)
    with pytest.raises(ValueError, match="n_splits"):
        evaluate(request, n_splits=1)
    with pytest.raises(NotImplementedError, match="purg"):
        evaluate(request, horizon=2, gap=2)


def test_same_inputs_always_produce_the_same_score() -> None:
    request = _request(_varied(120))
    first = evaluate(request, n_splits=3, gap=2, horizon=1)
    second = evaluate(request, n_splits=3, gap=2, horizon=1)
    assert first.model_dump() == second.model_dump()
