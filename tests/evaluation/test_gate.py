"""Tests for Layer 4b — the run-level gate verdict, per-fold rejection, and the point-in-time audit."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from forecasting_agent.evaluation.gate import run_gate
from forecasting_agent.evaluation.types import EvalRequest
from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def _request(returns: list[float], *, as_of_offset_days: int = 3650) -> EvalRequest:
    """Takes a return series and an as_of offset; returns a coherent all-hold EvalRequest over it."""
    n = len(returns)
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return EvalRequest(
        returns=returns,
        forecasts=[0.0] * n,
        calls=[0.5] * n,
        timestamps=[start + timedelta(days=i) for i in range(n)],
        as_of=start + timedelta(days=as_of_offset_days),
        segment="EQUITY_DELIVERY",
        position_notional=[10_000.0] * n,
        trade_side=["hold"] * n,
        capital=1_000_000.0,
    )


def _varied(n: int) -> list[float]:
    """Takes a length; returns a deterministic non-constant return series of that length."""
    return [float(np.sin(i) * 0.01) for i in range(n)]


def test_healthy_request_is_valid_with_all_folds_surviving() -> None:
    verdict = run_gate(_request(_varied(60)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "VALID"
    assert list(verdict.reasons) == []
    assert len(verdict.folds) == 3
    assert list(verdict.skipped) == []
    assert [f.fold_number for f in verdict.folds] == [0, 1, 2]


def test_timestamps_after_as_of_make_the_run_invalid() -> None:
    verdict = run_gate(_request(_varied(60), as_of_offset_days=10), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert "timestamps_exceed_as_of" in verdict.reasons


def test_infeasible_split_is_run_level_and_never_populates_skipped() -> None:
    verdict = run_gate(_request(_varied(10)), PurgedWalkForward(n_splits=4, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert list(verdict.reasons) == ["infeasible_split_configuration"]
    assert list(verdict.folds) == []
    assert list(verdict.skipped) == []


def test_below_min_train_size_fold_is_skipped_with_the_pinned_detail_format() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    assert verdict.status == "VALID"
    assert [s.fold_number for s in verdict.skipped] == [0]
    assert verdict.skipped[0].reason == "below_min_train_size"
    assert verdict.skipped[0].detail == "train size 1 < min_train_size 3"
    assert [f.fold_number for f in verdict.folds] == [1, 2, 3, 4]


def test_fold_numbers_use_emission_order_and_are_never_renumbered() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    survivors = {f.fold_number for f in verdict.folds}
    skipped = {s.fold_number for s in verdict.skipped}
    assert survivors & skipped == set()
    assert survivors | skipped == set(range(5))
    assert 0 not in survivors


def test_constant_series_skips_every_fold_for_degenerate_baseline() -> None:
    verdict = run_gate(_request([0.01] * 60), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert list(verdict.reasons) == ["insufficient_valid_folds"]
    assert [s.reason for s in verdict.skipped] == ["degenerate_baseline"] * 3
    assert verdict.skipped[0].detail == "mean(|Δy_train|) = 0.0"
    assert list(verdict.folds) == []


def test_fewer_than_two_valid_folds_is_run_level_invalid() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=12))
    assert verdict.status == "INVALID"
    assert "insufficient_valid_folds" in verdict.reasons
    assert len(verdict.folds) < 2


def test_exactly_two_valid_folds_is_still_valid() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=9))
    assert len(verdict.folds) == 2
    assert verdict.status == "VALID"
    assert list(verdict.reasons) == []


def test_below_min_train_size_takes_precedence_over_degenerate_baseline() -> None:
    verdict = run_gate(_request([0.01] * 20), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    by_number = {s.fold_number: s for s in verdict.skipped}
    assert by_number[0].reason == "below_min_train_size"
    assert by_number[1].reason == "degenerate_baseline"


def test_surviving_folds_carry_the_splitter_index_arrays() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    fold = verdict.folds[0]
    assert list(fold.train_idx) == [0, 1, 2]
    assert list(fold.test_idx) == [5, 6, 7, 8, 9]
    assert max(fold.train_idx) < min(fold.test_idx)


def test_gate_never_raises_on_any_of_its_documented_failure_modes() -> None:
    for splitter in (
        PurgedWalkForward(n_splits=4, gap=2, horizon=1),
        PurgedWalkForward(n_splits=3, gap=2, horizon=1),
    ):
        for series in ([0.01] * 10, _varied(10)):
            verdict = run_gate(_request(series), splitter)
            assert verdict.status in {"VALID", "INVALID"}


def test_gate_does_not_call_the_mase_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    import forecasting_agent.evaluation.gate as gate_module

    def _explode(*_args: object, **_kwargs: object) -> float:
        raise AssertionError("gate must not invoke mase()")

    monkeypatch.setattr(gate_module, "mase", _explode, raising=False)
    verdict = run_gate(_request(_varied(60)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "VALID"
