"""Tests for the evaluation package's Pydantic schema and its single exception type."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from forecasting_agent.evaluation.errors import DegenerateBaselineError
from forecasting_agent.evaluation.types import (
    CalibrationBin,
    EvalRequest,
    EvalResult,
    Fold,
    FoldSkipReason,
    GateVerdict,
    LayerMean,
    LayerScore,
)

_TS = [datetime(2025, 1, 1, tzinfo=UTC), datetime(2025, 1, 2, tzinfo=UTC), datetime(2025, 1, 3, tzinfo=UTC)]
_AS_OF = datetime(2025, 6, 1, tzinfo=UTC)


def _kwargs(**overrides: object) -> dict[str, object]:
    """Takes field overrides; returns a valid 3-period EvalRequest kwargs dict with those overrides applied."""
    base: dict[str, object] = {
        "returns": [0.01, -0.02, 0.03],
        "forecasts": [0.01, -0.01, 0.02],
        "calls": [0.6, 0.4, 0.7],
        "timestamps": _TS,
        "as_of": _AS_OF,
        "segment": "EQUITY_DELIVERY",
        "position_notional": [10_000.0, 10_000.0, 10_000.0],
        "trade_side": ["buy", "hold", "sell"],
        "capital": 1_000_000.0,
    }
    base.update(overrides)
    return base


def test_valid_request_constructs() -> None:
    request = EvalRequest(**_kwargs())  # type: ignore[arg-type]
    assert request.segment == "EQUITY_DELIVERY"
    assert request.capital == 1_000_000.0


def test_length_mismatch_names_every_offending_field_and_its_length() -> None:
    with pytest.raises(ValidationError) as excinfo:
        EvalRequest(**_kwargs(forecasts=[0.01, -0.01], calls=[0.6]))  # type: ignore[arg-type]
    message = str(excinfo.value)
    assert "length mismatch against returns (n=3)" in message
    assert "forecasts" in message
    assert "calls" in message


def test_empty_series_is_rejected() -> None:
    with pytest.raises(ValidationError, match="returns must not be empty"):
        EvalRequest(**_kwargs(returns=[], forecasts=[], calls=[], timestamps=[], position_notional=[], trade_side=[]))  # type: ignore[arg-type]


@pytest.mark.parametrize("bad_capital", [0.0, -1_000_000.0, float("inf"), float("nan")])
def test_capital_rejects_non_positive_and_non_finite(bad_capital: float) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(capital=bad_capital))  # type: ignore[arg-type]


@pytest.mark.parametrize("bad_calls", [[0.5, 1.4, 0.5], [0.5, -0.2, 0.5]])
def test_calls_rejects_values_outside_unit_interval(bad_calls: list[float]) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(calls=bad_calls))  # type: ignore[arg-type]


@pytest.mark.parametrize("field", ["returns", "forecasts", "position_notional"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_sequence_float_fields_reject_non_finite(field: str, bad: float) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(**{field: [bad, 1.0, 1.0]}))  # type: ignore[arg-type]


def test_naive_datetimes_rejected_on_timestamps_and_as_of() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(as_of=datetime(2025, 6, 1)))  # type: ignore[arg-type]  # noqa: DTZ001
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(timestamps=[datetime(2025, 1, 1), *_TS[1:]]))  # type: ignore[arg-type]  # noqa: DTZ001


def test_buy_or_sell_period_requires_strictly_positive_notional() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(position_notional=[0.0, 10_000.0, 10_000.0]))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(position_notional=[-10_000.0, 10_000.0, 10_000.0]))  # type: ignore[arg-type]


def test_hold_period_may_carry_zero_notional() -> None:
    request = EvalRequest(**_kwargs(trade_side=["hold", "hold", "hold"], position_notional=[0.0, 0.0, 0.0]))  # type: ignore[arg-type]
    assert list(request.position_notional) == [0.0, 0.0, 0.0]


def test_hold_period_rejects_negative_notional() -> None:
    with pytest.raises(ValidationError, match="position_notional must be non-negative"):
        EvalRequest(**_kwargs(trade_side=["hold", "hold", "hold"], position_notional=[0.0, -1.0, 0.0]))  # type: ignore[arg-type]


def test_missing_required_field_is_a_distinct_validation_path() -> None:
    kwargs = _kwargs()
    del kwargs["capital"]
    with pytest.raises(ValidationError) as excinfo:
        EvalRequest(**kwargs)  # type: ignore[arg-type]
    assert "capital" in str(excinfo.value)


def test_invalid_segment_and_trade_side_literals_rejected() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(segment="COMMODITY"))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(trade_side=["short", "hold", "sell"]))  # type: ignore[arg-type]


def test_result_models_construct_with_spec_shapes() -> None:
    fold = Fold(train_idx=[0, 1, 2], test_idx=[5, 6], fold_number=1)
    skip = FoldSkipReason(fold_number=0, reason="below_min_train_size", detail="train size 1 < min_train_size 3")
    verdict = GateVerdict(status="VALID", reasons=[], folds=[fold], skipped=[skip])
    score = LayerScore(layer=1, fold_number=1, value=1.0621, zero_forecast_mase=0.7588, beats_zero=False)
    result = EvalResult(verdict=verdict, layers=[score], layer_means={1: LayerMean(mean=1.0621, n_folds=2)})
    assert result.layer_means[1].n_folds == 2
    assert result.layers[0].calibration_bins is None
    assert result.layers[0].note is None
    assert result.layers[0].annualized is None
    assert CalibrationBin(count=0, mean_predicted=0.0, mean_observed=0.0).count == 0


def test_layer_means_key_is_restricted_to_the_three_layers() -> None:
    with pytest.raises(ValidationError):
        EvalResult(
            verdict=GateVerdict(status="VALID", reasons=[], folds=[], skipped=[]),
            layers=[],
            layer_means={4: LayerMean(mean=0.0, n_folds=2)},  # type: ignore[dict-item]
        )


def test_degenerate_baseline_error_is_a_plain_exception() -> None:
    assert issubclass(DegenerateBaselineError, Exception)
    with pytest.raises(DegenerateBaselineError, match=r"0\.0"):
        raise DegenerateBaselineError("mean(|Δy_train|) = 0.0")
