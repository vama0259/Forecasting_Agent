"""Public surface of the read-only M8 evaluation engine."""

from forecasting_agent.evaluation.pipeline import evaluate
from forecasting_agent.evaluation.types import EvalRequest, EvalResult, GateVerdict

__all__ = ["EvalRequest", "EvalResult", "GateVerdict", "evaluate"]
