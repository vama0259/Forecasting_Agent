"""DSPy MIPROv2 Prompt Compiler and shared prompt templates (ADR-028)."""

from forecasting_agent.prompt_compiler.compiler import PromptCompiler
from forecasting_agent.prompt_compiler.metrics import m8_prompt_metric
from forecasting_agent.prompt_compiler.signatures import (
    DIISignature,
    FIISignature,
    PriceAnchorSignature,
    RetailSignature,
)

__all__ = [
    "DIISignature",
    "FIISignature",
    "PriceAnchorSignature",
    "PromptCompiler",
    "RetailSignature",
    "m8_prompt_metric",
]
