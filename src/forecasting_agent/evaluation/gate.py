"""Layer 4b validation gate evaluating fold validity and point-in-time constraints."""

import math
from typing import Literal

import numpy as np

from forecasting_agent.evaluation.mase import train_baseline
from forecasting_agent.evaluation.types import EvalRequest, Fold, FoldSkipReason, GateVerdict
from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


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
        if len(train_idx) < splitter.min_train_size:
            detail = f"train size {len(train_idx)} < min_train_size {splitter.min_train_size}"
            skipped.append(FoldSkipReason(fold_number=i, reason="below_min_train_size", detail=detail))
        else:
            d = train_baseline(returns_arr[train_idx])
            if (not math.isfinite(d)) or d == 0.0:
                token = "nan" if math.isnan(d) else ("inf" if math.isinf(d) else "0.0")
                detail = f"mean(|Δy_train|) = {token}"
                skipped.append(FoldSkipReason(fold_number=i, reason="degenerate_baseline", detail=detail))
            else:
                survivors.append(Fold(train_idx=train_idx.tolist(), test_idx=test_idx.tolist(), fold_number=i))

    if len(survivors) < 2:
        reasons.append("insufficient_valid_folds")

    status: Literal["VALID", "INVALID"] = "INVALID" if reasons else "VALID"
    folds = survivors if not reasons else []
    return GateVerdict(status=status, reasons=reasons, folds=folds, skipped=skipped)
