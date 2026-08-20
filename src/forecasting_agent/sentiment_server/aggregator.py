"""Recency-weighted exponential decay aggregator and data models for sentiment scoring."""

import math
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


class HeadlineInput(BaseModel):
    """Input headline with optional publication timestamp."""

    text: str = Field(..., max_length=512, description="Headline or snippet text")
    timestamp: str | None = Field(None, description="ISO-8601 timestamp of publication")


class HeadlineScore(BaseModel):
    """Scored headline with individual probabilities and recency weight."""

    text: str
    positive: float
    negative: float
    neutral: float
    score: float
    weight: float


class SentimentResult(BaseModel):
    """Aggregated sentiment response."""

    score: float = Field(..., description="Aggregated polarity in [-1.0, 1.0]")
    label: Literal["positive", "negative", "neutral"]
    confidence: float = Field(..., description="Weighted non-neutral conviction in [0.0, 1.0]")
    headline_count: int
    headlines: list[HeadlineScore]
    device: str
    degraded: bool = False


def _parse_timestamp(ts: str | datetime | None) -> datetime | None:
    """Parse ISO timestamp string or datetime into UTC datetime."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=UTC)
        return ts.astimezone(UTC)
    try:
        cleaned = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except Exception:
        return None


def aggregate_sentiment(
    headlines: list[HeadlineInput],
    scores: list[dict[str, float]],
    as_of: datetime | str | None = None,
    half_life_hours: float = 24.0,
    device: str = "cpu",
) -> SentimentResult:
    """Aggregate individual headline sentiment probabilities using exponential recency decay.

    Formula:
      Delta_t_i = max(0.0, (t_ref - t_i)_hours)
      w_i = 2 ** (-Delta_t_i / tau)
      s_i = p_pos - p_neg
      S = sum(w_i * s_i) / sum(w_i)  in [-1.0, 1.0]
      C = sum(w_i * (1.0 - p_neu)) / sum(w_i)  in [0.0, 1.0]
    """
    if not headlines or not scores or len(headlines) != len(scores):
        return SentimentResult(
            score=0.0,
            label="neutral",
            confidence=0.0,
            headline_count=0,
            headlines=[],
            device=device,
            degraded=False,
        )

    t_ref = _parse_timestamp(as_of)
    if t_ref is None:
        t_ref = datetime.now(UTC)

    scored_headlines: list[HeadlineScore] = []
    total_weight = 0.0
    weighted_score_sum = 0.0
    weighted_conf_sum = 0.0

    for headline, score_dict in zip(headlines, scores, strict=True):
        pos = float(score_dict.get("positive", 0.0))
        neg = float(score_dict.get("negative", 0.0))
        neu = float(score_dict.get("neutral", 0.0))

        s_i = pos - neg
        c_i = max(0.0, min(1.0, 1.0 - neu))

        w_i = 1.0
        if headline.timestamp:
            t_i = _parse_timestamp(headline.timestamp)
            if t_i is not None and half_life_hours > 0.0:
                delta_hours = max(0.0, (t_ref - t_i).total_seconds() / 3600.0)
                w_i = math.pow(2.0, -delta_hours / half_life_hours)

        scored_headlines.append(
            HeadlineScore(
                text=headline.text,
                positive=pos,
                negative=neg,
                neutral=neu,
                score=s_i,
                weight=w_i,
            )
        )

        total_weight += w_i
        weighted_score_sum += w_i * s_i
        weighted_conf_sum += w_i * c_i

    if total_weight <= 0.0:
        return SentimentResult(
            score=0.0,
            label="neutral",
            confidence=0.0,
            headline_count=len(scored_headlines),
            headlines=scored_headlines,
            device=device,
            degraded=False,
        )

    agg_score = max(-1.0, min(1.0, weighted_score_sum / total_weight))
    agg_conf = max(0.0, min(1.0, weighted_conf_sum / total_weight))

    if agg_score >= 0.15:
        label: Literal["positive", "negative", "neutral"] = "positive"
    elif agg_score <= -0.15:
        label = "negative"
    else:
        label = "neutral"

    return SentimentResult(
        score=agg_score,
        label=label,
        confidence=agg_conf,
        headline_count=len(scored_headlines),
        headlines=scored_headlines,
        device=device,
        degraded=False,
    )
