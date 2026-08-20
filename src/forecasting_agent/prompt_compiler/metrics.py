"""M8 Composite Optimization Metric for DSPy MIPROv2 compilation (ADR-028)."""

import ast
import math
from typing import Any


def m8_prompt_metric(
    example: Any,
    prediction: Any,
    trace: Any = None,
) -> float:
    """Calculates composite M8 loss metric in [0.0, 1.0].

    Components:
    - 40% Directional match with actual return direction.
    - 40% Brier calibration: 1.0 - (probability - target)^2 normalized.
    - 20% Confidence calibration & overconfidence penalty.
    - Gating rule: 0.0 if direction/probability are invalid or python_code has syntax errors.
    """
    # 1. Validate direction
    pred_dir = str(getattr(prediction, "direction", "")).lower().strip()
    target_dir = str(getattr(example, "target_direction", "")).lower().strip()

    if pred_dir not in ("up", "down") or target_dir not in ("up", "down"):
        return 0.0

    # 2. Validate probability
    try:
        prob = float(getattr(prediction, "probability", 0.5))
        if not math.isfinite(prob) or prob < 0.0 or prob > 1.0:
            return 0.0
    except (ValueError, TypeError):
        return 0.0

    # 3. Python Code Syntax Check (if present in signature)
    code = getattr(prediction, "python_code", None)
    if code is not None and isinstance(code, str) and code.strip():
        try:
            ast.parse(code)
        except SyntaxError:
            return 0.0

    # Direction score (0.40 weight)
    dir_match = 1.0 if pred_dir == target_dir else 0.0

    # Brier calibration score (0.40 weight)
    # Target binary: 1.0 if target is up, 0.0 if target is down
    target_binary = 1.0 if target_dir == "up" else 0.0
    # Canonical probability of UP: if pred_dir is up, prob, else (1 - prob)
    p_up = prob if pred_dir == "up" else (1.0 - prob)
    brier_error = (p_up - target_binary) ** 2
    # Brier score ranges from 0 (perfect) to 1 (worst). Calibration reward is 1 - brier_error.
    brier_score = max(0.0, 1.0 - brier_error)

    # Overconfidence Penalty (0.20 weight)
    # Single-day return edge rarely exceeds 70%. Penalize extreme overconfidence.
    confidence = float(getattr(prediction, "confidence", 0.5))
    confidence_penalty = 0.5 if (prob > 0.80 or confidence > 0.85) else 1.0

    composite_score = 0.40 * dir_match + 0.40 * brier_score + 0.20 * confidence_penalty

    return max(0.0, min(1.0, float(composite_score)))
