"""Tests for Layer 1 — MASE with a Hyndman train-fold denominator, plus the zero-forecast baseline."""

import math

import numpy as np
import pytest
from hypothesis import assume, given
from hypothesis import strategies as st
from numpy.typing import NDArray

from forecasting_agent.evaluation.errors import DegenerateBaselineError
from forecasting_agent.evaluation.mase import mase, naive_forecast, train_baseline, zero_forecast_mase

NAIVE_ON_SEEDED = 1.0620844567408834
ZERO_ON_SEEDED = 0.7588485867586092


def test_perfect_forecast_scores_zero(seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]]) -> None:
    train, test = seeded_train_test
    assert mase(train, test, test.copy()) == 0.0


def test_naive_forecast_on_seeded_series_matches_measured_value(
    seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]],
) -> None:
    train, test = seeded_train_test
    assert mase(train, test, naive_forecast(train, test)) == pytest.approx(NAIVE_ON_SEEDED, rel=1e-12)


def test_naive_scores_exactly_one_on_a_matched_scale_series() -> None:
    train = np.array([0.0, 1.0, 0.0, 1.0, 0.0, 1.0])
    test = np.array([0.0, 1.0, 0.0, 1.0])
    assert mase(train, test, naive_forecast(train, test)) == pytest.approx(1.0, rel=1e-12)


def test_zero_forecast_is_reported_and_beats_naive_on_the_seeded_series(
    seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]],
) -> None:
    train, test = seeded_train_test
    zero = zero_forecast_mase(train, test)
    naive = mase(train, test, naive_forecast(train, test))
    assert zero == pytest.approx(ZERO_ON_SEEDED, rel=1e-12)
    assert zero < naive


def test_naive_forecast_is_last_observed_carried_forward() -> None:
    train = np.array([1.0, 2.0, 3.0])
    test = np.array([10.0, 20.0, 30.0])
    assert np.array_equal(naive_forecast(train, test), np.array([3.0, 10.0, 20.0]))


def test_train_baseline_is_unguarded_and_reports_each_degenerate_shape() -> None:
    assert train_baseline(np.array([1.0, 2.0, 4.0])) == pytest.approx(1.5)
    assert train_baseline(np.array([5.0, 5.0, 5.0, 5.0])) == 0.0
    assert math.isnan(train_baseline(np.array([5.0])))
    assert math.isinf(train_baseline(np.array([-1e308, 1e308, -1e308])))


def test_mase_raises_on_constant_train_fold() -> None:
    train = np.array([5.0, 5.0, 5.0, 5.0, 5.0, 5.0])
    test = np.array([1.0, 2.0])
    with pytest.raises(DegenerateBaselineError):
        mase(train, test, np.array([1.0, 2.0]))


def test_mase_raises_on_non_finite_baseline_from_float_overflow() -> None:
    train = np.array([-1e308, 1e308, -1e308])
    test = np.array([1.0, 2.0])
    with pytest.raises(DegenerateBaselineError):
        mase(train, test, np.array([1.0, 2.0]))


def test_mase_raises_on_single_element_train_fold() -> None:
    with pytest.raises(DegenerateBaselineError):
        mase(np.array([5.0]), np.array([1.0, 2.0]), np.array([1.0, 2.0]))


@given(
    train=st.lists(st.floats(-100.0, 100.0, allow_nan=False, allow_infinity=False), min_size=3, max_size=60),
    test=st.lists(st.floats(-100.0, 100.0, allow_nan=False, allow_infinity=False), min_size=1, max_size=30),
)
def test_mase_is_non_negative(train: list[float], test: list[float]) -> None:
    train_arr = np.asarray(train, dtype=np.float64)
    assume(len(train_arr) >= 3)
    baseline = train_baseline(train_arr)
    assume(math.isfinite(baseline) and baseline > 0.0)
    test_arr = np.asarray(test, dtype=np.float64)
    assert mase(train_arr, test_arr, naive_forecast(train_arr, test_arr)) >= 0.0
