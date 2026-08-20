"""Tests for DSPy Prompt Compiler, Signatures, and M8 Prompt Metric (ADR-028)."""

from pathlib import Path
from types import SimpleNamespace

import dspy

from forecasting_agent.prompt_compiler.compiler import PromptCompiler
from forecasting_agent.prompt_compiler.dataset import get_fii_examples, get_price_anchor_examples
from forecasting_agent.prompt_compiler.metrics import m8_prompt_metric
from forecasting_agent.prompt_compiler.signatures import (
    DIISignature,
    FIISignature,
    PriceAnchorSignature,
    RetailSignature,
)


def test_signatures_input_output_fields():
    """Verifies that all 4 participant agent signatures define required typed fields."""
    for sig_cls in (PriceAnchorSignature, FIISignature, DIISignature, RetailSignature):
        fields = sig_cls.model_fields
        assert "symbol" in fields
        assert "as_of" in fields
        assert "reasoning" in fields
        assert "direction" in fields
        assert "probability" in fields
        assert "confidence" in fields


def test_price_anchor_signature_has_python_code_field():
    fields = PriceAnchorSignature.model_fields
    assert "python_code" in fields
    assert "ohlcv_summary" in fields


def test_m8_prompt_metric_perfect_calibrated_match():
    """Correct direction and well-calibrated probability yields high score."""
    example = SimpleNamespace(target_direction="up")
    prediction = SimpleNamespace(
        direction="up",
        probability=0.62,
        confidence=0.65,
        python_code="import numpy as np\nx = 1\n",
    )
    score = m8_prompt_metric(example, prediction)
    assert 0.80 <= score <= 1.0


def test_m8_prompt_metric_direction_mismatch():
    """Wrong direction drops the composite score."""
    example = SimpleNamespace(target_direction="up")
    prediction = SimpleNamespace(
        direction="down",
        probability=0.60,
        confidence=0.55,
    )
    score = m8_prompt_metric(example, prediction)
    assert score < 0.65


def test_m8_prompt_metric_overconfidence_penalty():
    """Extreme uncalibrated probabilities receive overconfidence penalty."""
    example = SimpleNamespace(target_direction="up")
    calibrated_pred = SimpleNamespace(direction="up", probability=0.60, confidence=0.60)
    overconfident_pred = SimpleNamespace(direction="up", probability=0.95, confidence=0.95)

    score_calib = m8_prompt_metric(example, calibrated_pred)
    score_overconf = m8_prompt_metric(example, overconfident_pred)

    assert score_calib > score_overconf


def test_m8_prompt_metric_syntax_error_in_code_yields_zero():
    """Syntax error in generated python code fails the gating check."""
    example = SimpleNamespace(target_direction="down")
    prediction = SimpleNamespace(
        direction="down",
        probability=0.60,
        confidence=0.60,
        python_code="def broken_syntax(:\n   pass",
    )
    score = m8_prompt_metric(example, prediction)
    assert score == 0.0


def test_m8_prompt_metric_invalid_direction_or_nan():
    example = SimpleNamespace(target_direction="up")
    prediction = SimpleNamespace(direction="neutral", probability=0.50)
    assert m8_prompt_metric(example, prediction) == 0.0

    prediction_nan = SimpleNamespace(direction="up", probability=float("nan"))
    assert m8_prompt_metric(example, prediction_nan) == 0.0


def test_dataset_loader():
    price_demos = get_price_anchor_examples()
    assert len(price_demos) >= 3
    for demo in price_demos:
        assert demo.symbol
        assert demo.direction in ("up", "down")

    fii_demos = get_fii_examples()
    assert len(fii_demos) >= 2


def test_prompt_compiler_build_and_export(tmp_path: Path):
    compiler = PromptCompiler()
    program = compiler.build_program(PriceAnchorSignature)
    assert isinstance(program, dspy.Module)

    # Test export
    out_file = tmp_path / "compiled_price_demos.j2"
    compiler.export_compiled_exemplars(program, out_file)
    assert out_file.exists()
    content = out_file.read_text(encoding="utf-8")
    assert "compiled_demos" in content
