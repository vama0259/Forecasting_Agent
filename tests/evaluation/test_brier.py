"""Tests for Layer 2 — Brier score under the scale_by_half=True convention, plus 10-bin calibration."""

from unittest.mock import patch

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.brier import BIN_EDGES, brier, bull_labels, calibration_bins


def test_perfect_predictions_score_zero() -> None:
    calls = np.array([0.0, 1.0, 0.0, 1.0])
    returns = np.array([-0.01, 0.01, -0.02, 0.02])
    assert brier(calls, returns) == pytest.approx(0.0)


def test_always_confident_and_wrong_scores_one() -> None:
    calls = np.array([1.0, 0.0, 1.0, 0.0])
    returns = np.array([-0.01, 0.01, -0.02, 0.02])
    assert brier(calls, returns) == pytest.approx(1.0)


def test_scale_by_half_true_is_passed_as_a_literal() -> None:
    calls = np.array([1.0, 0.0])
    returns = np.array([-0.01, 0.01])
    with patch("forecasting_agent.evaluation.brier.brier_score_loss", return_value=1.0) as spy:
        brier(calls, returns)
    assert spy.call_count == 1
    assert spy.call_args.kwargs["scale_by_half"] is True


def test_zero_return_is_labelled_not_bull() -> None:
    assert list(bull_labels(np.array([0.01, 0.0, -0.01]))) == [1, 0, 0]


def test_bin_edges_are_eleven_points_over_the_unit_interval() -> None:
    assert len(BIN_EDGES) == 11
    assert BIN_EDGES[0] == 0.0
    assert BIN_EDGES[-1] == 1.0
    assert BIN_EDGES[3] == 0.30000000000000004


def test_all_ten_bins_reported_including_empty_ones() -> None:
    calls = np.array([0.05, 0.05, 0.95, 0.95])
    returns = np.array([-0.01, 0.01, 0.01, 0.01])
    bins = calibration_bins(calls, returns)
    assert len(bins) == 10
    assert [b.count for b in bins] == [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]
    assert bins[0].mean_predicted == pytest.approx(0.05)
    assert bins[0].mean_observed == pytest.approx(0.5)
    assert bins[9].mean_predicted == pytest.approx(0.95)
    assert bins[9].mean_observed == pytest.approx(1.0)


def test_empty_bins_report_zero_not_nan() -> None:
    bins = calibration_bins(np.array([0.05, 0.95]), np.array([0.01, 0.01]))
    for index in range(1, 9):
        assert bins[index].count == 0
        assert bins[index].mean_predicted == 0.0
        assert bins[index].mean_observed == 0.0


def test_boundary_confidence_lands_in_the_measured_bin_not_the_naive_one() -> None:
    bins = calibration_bins(np.array([0.3]), np.array([0.01]))
    assert bins[2].count == 1
    assert bins[3].count == 0


def test_unit_endpoints_do_not_overflow_the_bin_range() -> None:
    bins = calibration_bins(np.array([0.0, 1.0]), np.array([-0.01, 0.01]))
    assert bins[0].count == 1
    assert bins[9].count == 1


@given(
    st.lists(
        st.tuples(st.floats(0.0, 1.0, allow_nan=False), st.floats(-1.0, 1.0, allow_nan=False, allow_infinity=False)),
        min_size=1,
        max_size=50,
    )
)
def test_brier_is_within_the_unit_interval(pairs: list[tuple[float, float]]) -> None:
    calls = np.asarray([p[0] for p in pairs], dtype=np.float64)
    returns = np.asarray([p[1] for p in pairs], dtype=np.float64)
    assert 0.0 <= brier(calls, returns) <= 1.0
