"""Layer 4b validation gate evaluating fold validity and point-in-time constraints."""

import math
from typing import Literal

import numpy as np

from forecasting_agent.evaluation.mase import train_baseline
from forecasting_agent.evaluation.types import EvalRequest, Fold, FoldSkipReason, GateVerdict
from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def _format_degenerate_detail(d: float) -> str:
    if math.isnan(d):
        formatted_val = "nan"
    elif math.isinf(d):
        formatted_val = "inf"
    else:
        formatted_val = "0.0"
    return f"mean(|Δy_train|) = {formatted_val}"


def _check_fold(
    fold_idx: int,
    train_idx: list[int],
    test_idx: list[int],
    min_train_size: int,
    returns_arr: np.ndarray,
) -> tuple[Fold | None, FoldSkipReason | None]:
    if len(train_idx) < min_train_size:
        detail = f"train size {len(train_idx)} < min_train_size {min_train_size}"
        return None, FoldSkipReason(fold_number=fold_idx, reason="below_min_train_size", detail=detail)

    d = train_baseline(returns_arr[train_idx])
    if (not math.isfinite(d)) or math.isclose(d, 0.0, abs_tol=1e-15):
        detail = _format_degenerate_detail(d)
        return None, FoldSkipReason(fold_number=fold_idx, reason="degenerate_baseline", detail=detail)

    return Fold(train_idx=train_idx, test_idx=test_idx, fold_number=fold_idx), None


def run_gate(request: EvalRequest, splitter: PurgedWalkForward) -> GateVerdict:
    """Takes evaluation request and walk-forward splitter; returns GateVerdict with surviving and skipped folds."""
    reasons: list[str] = []

    if max(request.timestamps) > request.as_of:
        reasons.append("timestamps_exceed_as_of")

    returns_arr = np.asarray(request.returns, dtype=np.float64)
    try:
        splits = list(splitter.split(returns_arr))
    except ValueError:
        reasons.append("infeasible_split_configuration")
        return GateVerdict(status="INVALID", reasons=reasons, folds=[], skipped=[])

    survivors: list[Fold] = []
    skipped: list[FoldSkipReason] = []

    for i, (train_idx, test_idx) in enumerate(splits):
        fold, skip = _check_fold(i, train_idx.tolist(), test_idx.tolist(), splitter.min_train_size, returns_arr)
        if skip is not None:
            skipped.append(skip)
        elif fold is not None:
            survivors.append(fold)

    if len(survivors) < 2:
        reasons.append("insufficient_valid_folds")

    status: Literal["VALID", "INVALID"] = "INVALID" if reasons else "VALID"
    folds = survivors if not reasons else []
    return GateVerdict(status=status, reasons=reasons, folds=folds, skipped=skipped)
