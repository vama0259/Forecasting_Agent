"""Tests for Layer 4a — the PurgedWalkForward splitter wrapping TimeSeriesSplit with an embargo."""

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def test_fold_boundaries_match_the_measured_timeseriessplit_output() -> None:
    folds = list(PurgedWalkForward(n_splits=3, gap=2, horizon=1).split(np.zeros(20)))
    assert len(folds) == 3
    boundaries = [(int(t[0]), int(t[-1]), int(v[0]), int(v[-1])) for t, v in folds]
    assert boundaries == [(0, 2, 5, 9), (0, 7, 10, 14), (0, 12, 15, 19)]


def test_train_sizes_match_the_measured_degenerate_configuration() -> None:
    folds = list(PurgedWalkForward(n_splits=5, gap=4, horizon=1).split(np.zeros(20)))
    assert [len(t) for t, _ in folds] == [1, 4, 7, 10, 13]


def test_split_does_not_filter_below_min_train_size_folds() -> None:
    splitter = PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3)
    assert len(list(splitter.split(np.zeros(20)))) == 5
    assert splitter.min_train_size == 3


def test_gap_defaults_to_horizon_not_to_zero() -> None:
    assert PurgedWalkForward().gap == 1
    assert PurgedWalkForward(horizon=1, gap=4).gap == 4


def test_gap_below_horizon_raises_value_error() -> None:
    with pytest.raises(ValueError, match="gap"):
        PurgedWalkForward(n_splits=3, gap=0, horizon=1)


def test_multi_bar_horizon_raises_not_implemented_naming_purging() -> None:
    with pytest.raises(NotImplementedError, match="purg"):
        PurgedWalkForward(n_splits=3, gap=5, horizon=2)


@pytest.mark.parametrize(
    ("kwargs", "token"),
    [
        ({"min_train_size": 2}, "min_train_size"),
        ({"min_train_size": 0}, "min_train_size"),
        ({"n_splits": 1}, "n_splits"),
        ({"horizon": 0}, "horizon"),
    ],
)
def test_constructor_bounds_are_enforced_with_the_offending_parameter_named(kwargs: dict[str, int], token: str) -> None:
    with pytest.raises((ValueError, NotImplementedError), match=token):
        PurgedWalkForward(**kwargs)


def test_infeasible_configuration_propagates_value_error_from_the_splitter() -> None:
    with pytest.raises(ValueError):
        list(PurgedWalkForward(n_splits=4, gap=2, horizon=1).split(np.zeros(10)))


def test_get_n_splits_reports_the_configured_count() -> None:
    assert PurgedWalkForward(n_splits=3).get_n_splits() == 3


def test_embargo_leaves_at_least_horizon_bars_between_train_and_test() -> None:
    for train, test in PurgedWalkForward(n_splits=3, gap=2, horizon=1).split(np.zeros(20)):
        assert int(test[0]) - int(train[-1]) > 1


@given(
    n_splits=st.integers(2, 5),
    gap=st.integers(1, 4),
    n_samples=st.integers(60, 200),
)
def test_train_indices_are_always_strictly_before_test_indices(n_splits: int, gap: int, n_samples: int) -> None:
    for train, test in PurgedWalkForward(n_splits=n_splits, gap=gap, horizon=1).split(np.zeros(n_samples)):
        assert int(train.max()) < int(test.min())
