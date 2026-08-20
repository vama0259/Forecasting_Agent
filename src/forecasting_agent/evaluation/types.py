"""Pydantic v2 schemas and models for the evaluation engine."""

from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, model_validator

TradeSide = Literal["buy", "sell", "hold"]
Segment = Literal["EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS"]


class EvalRequest(BaseModel):
    """Evaluation request data contract holding price-action series and configuration."""

    returns: Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    forecasts: Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    calls: Sequence[Annotated[float, Field(ge=0.0, le=1.0)]]
    timestamps: Sequence[AwareDatetime]
    as_of: AwareDatetime
    segment: Segment
    position_notional: Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    trade_side: Sequence[TradeSide]
    capital: Annotated[float, Field(gt=0.0, allow_inf_nan=False)]

    @model_validator(mode="after")
    def _validate_lengths_and_notionals(self) -> "EvalRequest":
        """Takes self; returns self after validating sequence lengths and trade side notionals."""
        n = len(self.returns)
        mismatched: dict[str, int] = {}
        for field_name in ("forecasts", "calls", "timestamps", "position_notional", "trade_side"):
            val: Sequence[object] = getattr(self, field_name)
            if len(val) != n:
                mismatched[field_name] = len(val)
        if mismatched:
            details = ", ".join(f"'{k}': {v}" for k, v in sorted(mismatched.items()))
            raise ValueError(f"length mismatch against returns (n={n}): {{{details}}}")

        for i, (side, notional) in enumerate(zip(self.trade_side, self.position_notional, strict=True)):
            if side in ("buy", "sell") and notional <= 0.0:
                msg = f"index {i}: {side} trade requires strictly positive position_notional, got {notional}"
                raise ValueError(msg)

        return self


class Fold(BaseModel):
    """Train and test index arrays defining a single walk-forward cross-validation fold."""

    train_idx: Sequence[int]
    test_idx: Sequence[int]
    fold_number: int


class FoldSkipReason(BaseModel):
    """Reason and detail for why a walk-forward split fold was skipped."""

    fold_number: int
    reason: Literal["degenerate_baseline", "below_min_train_size"]
    detail: str


class CalibrationBin(BaseModel):
    """Observed vs predicted probability statistics for a single confidence interval bin."""

    count: int
    mean_predicted: float
    mean_observed: float


class BrierDecomposition(BaseModel):
    """Murphy decomposition of a Brier score: Brier = reliability - resolution + uncertainty."""

    reliability: float
    resolution: float
    uncertainty: float
    base_rate: float


class DirectionHitRate(BaseModel):
    """Directional accuracy over committed (non-0.5) calls, with a normal-approximation z against a fair coin."""

    hits: int
    # Counts only committed calls -- abstentions (exactly 0.5) are excluded, so this can be well
    # below the number of scored observations for a forecaster that often declines to call.
    n: int
    rate: float
    z_vs_coin: float


class LayerScore(BaseModel):
    """Evaluation score and optional diagnostic metadata for a single layer on a single fold."""

    layer: Literal[1, 2, 3]
    fold_number: int
    value: float | None
    calibration_bins: Sequence[CalibrationBin] | None = None
    note: str | None = None
    zero_forecast_mase: float | None = None
    beats_zero: bool | None = None
    annualized: bool | None = None
    # Phase 1 & 2 Extensions:
    ece: float | None = None
    pearson_ic: float | None = None
    rank_ic: float | None = None
    profit_factor: float | None = None
    max_drawdown: float | None = None
    calmar_ratio: float | None = None


class LayerMean(BaseModel):
    """Aggregated arithmetic mean and surviving fold count for a single evaluation layer."""

    mean: float
    n_folds: int


class GateVerdict(BaseModel):
    """Layer 4 walk-forward and point-in-time validation gate verdict."""

    status: Literal["VALID", "INVALID"]
    reasons: Sequence[str]
    folds: Sequence[Fold]
    skipped: Sequence[FoldSkipReason]


class EvalResult(BaseModel):
    """Gate verdict, per-fold layer scores, layer means, and diagnostics pooled over all test observations."""

    verdict: GateVerdict
    layers: Sequence[LayerScore]
    layer_means: dict[Literal[1, 2, 3], LayerMean]
    # Pooled over every test observation across surviving folds, not averaged over folds: a binomial
    # z-statistic and a bin-based decomposition are only meaningful at the observation level, and
    # averaging per-fold values would silently understate n by ~an order of magnitude.
    direction: DirectionHitRate | None = None
    brier_split: BrierDecomposition | None = None
