# Tests the sandbox walk-forward helper cannot emit a training row that leaks its own prediction target.

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sandbox" / "agent_lib"))

from walkforward import walk_forward_steps


def test_no_training_row_ever_reaches_the_predicted_row():
    """The property the whole helper exists for: max(train) < predict, at every single step."""
    steps = list(walk_forward_steps(300, min_train=45, feature_start=21))

    assert steps, "helper produced no steps at all"
    for train_rows, predict_row in steps:
        assert max(train_rows) < predict_row, f"row {max(train_rows)} trains on the target of predict row {predict_row}"


def test_training_targets_stay_strictly_in_the_past():
    # A training row j carries target j+1; that target must land before the predicted row's own target.
    for train_rows, predict_row in walk_forward_steps(200, min_train=45, feature_start=0):
        assert max(train_rows) + 1 < predict_row + 1


def test_min_train_is_respected_and_short_series_yield_nothing():
    assert all(len(t) >= 45 for t, _ in walk_forward_steps(120, min_train=45))
    assert list(walk_forward_steps(30, min_train=45)) == []


def test_training_window_expands_monotonically():
    sizes = [len(t) for t, _ in walk_forward_steps(150, min_train=45, feature_start=0)]
    assert sizes == sorted(sizes), "an expanding walk-forward window must never shrink"


@pytest.mark.parametrize("feature_start", [0, 21, 50])
def test_never_indexes_past_the_series(feature_start):
    n = 180
    for train_rows, predict_row in walk_forward_steps(n, min_train=45, feature_start=feature_start):
        # predict_row + 1 is the forecast target, so it must remain a real index.
        assert predict_row + 1 < n
        assert max(train_rows) + 1 < n


def test_calculate_calibrated_probability():
    from walkforward import calculate_calibrated_probability

    # Zero forecast return yields exact 0.50 (neutral)
    assert calculate_calibrated_probability(0.0, 0.015) == pytest.approx(0.50, abs=1e-4)

    # Positive return yields > 0.50
    p_up = calculate_calibrated_probability(0.005, 0.015)
    assert 0.50 < p_up < 0.70

    # Negative return yields < 0.50
    p_down = calculate_calibrated_probability(-0.005, 0.015)
    assert 0.30 < p_down < 0.50
    assert p_up + p_down == pytest.approx(1.0, abs=1e-4)

    # Non-finite or zero volatility handles safely without throwing
    assert calculate_calibrated_probability(0.01, 0.0) == 0.50
    assert calculate_calibrated_probability(float("nan"), 0.015) == 0.50
    assert calculate_calibrated_probability(0.01, float("inf")) == 0.50
