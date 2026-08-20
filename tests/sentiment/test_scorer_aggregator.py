"""Unit tests for FinBERTScorer and recency-weighted decay aggregator."""

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
import torch

from forecasting_agent.sentiment_server.aggregator import (
    HeadlineInput,
    SentimentResult,
    aggregate_sentiment,
)
from forecasting_agent.sentiment_server.scorer import FinBERTScorer

# =====================================================================
# Aggregator & Recency Decay Tests
# =====================================================================


def test_empty_headlines_returns_neutral_result() -> None:
    """Empty headline list returns neutral sentiment with zero confidence."""
    result = aggregate_sentiment([], [], device="cpu")
    assert isinstance(result, SentimentResult)
    assert result.score == 0.0
    assert result.label == "neutral"
    assert result.confidence == 0.0
    assert result.headline_count == 0
    assert result.headlines == []
    assert result.device == "cpu"
    assert result.degraded is False


def test_recency_decay_exact_weights() -> None:
    """Test half-life exponential decay weights at 0h, 24h, 48h, 72h."""
    as_of = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    headlines = [
        HeadlineInput(text="T0", timestamp="2026-08-20T12:00:00Z"),  # dt = 0h -> w = 1.0
        HeadlineInput(text="T24", timestamp="2026-08-19T12:00:00Z"),  # dt = 24h -> w = 0.5
        HeadlineInput(text="T48", timestamp="2026-08-18T12:00:00Z"),  # dt = 48h -> w = 0.25
        HeadlineInput(text="T72", timestamp="2026-08-17T12:00:00Z"),  # dt = 72h -> w = 0.125
    ]
    scores = [
        {"positive": 0.8, "negative": 0.1, "neutral": 0.1},
        {"positive": 0.8, "negative": 0.1, "neutral": 0.1},
        {"positive": 0.8, "negative": 0.1, "neutral": 0.1},
        {"positive": 0.8, "negative": 0.1, "neutral": 0.1},
    ]

    result = aggregate_sentiment(headlines, scores, as_of=as_of, half_life_hours=24.0)

    assert len(result.headlines) == 4
    assert pytest.approx(result.headlines[0].weight, rel=1e-4) == 1.0
    assert pytest.approx(result.headlines[1].weight, rel=1e-4) == 0.5
    assert pytest.approx(result.headlines[2].weight, rel=1e-4) == 0.25
    assert pytest.approx(result.headlines[3].weight, rel=1e-4) == 0.125


def test_recency_weighted_aggregation_math() -> None:
    """Verify aggregated score and confidence match manual calculation."""
    as_of = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    headlines = [
        HeadlineInput(text="Recent Bullish", timestamp="2026-08-20T12:00:00Z"),  # dt = 0 -> w = 1.0
        HeadlineInput(text="Old Bearish", timestamp="2026-08-19T12:00:00Z"),  # dt = 24 -> w = 0.5
    ]
    scores = [
        {"positive": 0.8, "negative": 0.0, "neutral": 0.2},  # score = 0.8, neutral = 0.2
        {"positive": 0.1, "negative": 0.7, "neutral": 0.2},  # score = -0.6, neutral = 0.2
    ]

    result = aggregate_sentiment(headlines, scores, as_of=as_of, half_life_hours=24.0)

    # w0 = 1.0, s0 = 0.8, c0 = 1 - 0.2 = 0.8
    # w1 = 0.5, s1 = -0.6, c1 = 1 - 0.2 = 0.8
    # total_weight = 1.5
    # S = (1.0*0.8 + 0.5*(-0.6)) / 1.5 = (0.8 - 0.3) / 1.5 = 0.5 / 1.5 = 0.3333...
    # C = (1.0*0.8 + 0.5*0.8) / 1.5 = 0.8
    assert pytest.approx(result.score, rel=1e-4) == 0.333333
    assert pytest.approx(result.confidence, rel=1e-4) == 0.8
    assert result.label == "positive"
    assert result.headline_count == 2


def test_label_classification_thresholds() -> None:
    """Test label classification boundaries (+0.15, -0.15, and neutral)."""
    # Positive >= +0.15
    h_pos = [HeadlineInput(text="Good")]
    s_pos = [{"positive": 0.25, "negative": 0.10, "neutral": 0.65}]  # score = 0.15
    res_pos = aggregate_sentiment(h_pos, s_pos)
    assert res_pos.label == "positive"

    # Negative <= -0.15
    h_neg = [HeadlineInput(text="Bad")]
    s_neg = [{"positive": 0.10, "negative": 0.25, "neutral": 0.65}]  # score = -0.15
    res_neg = aggregate_sentiment(h_neg, s_neg)
    assert res_neg.label == "negative"

    # Neutral between -0.15 and +0.15
    h_neu = [HeadlineInput(text="Okay")]
    s_neu = [{"positive": 0.20, "negative": 0.10, "neutral": 0.70}]  # score = 0.10
    res_neu = aggregate_sentiment(h_neu, s_neu)
    assert res_neu.label == "neutral"


def test_missing_and_invalid_timestamps_default_to_full_weight() -> None:
    """Missing or unparseable timestamps default to weight=1.0."""
    as_of = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    headlines = [
        HeadlineInput(text="No timestamp", timestamp=None),
        HeadlineInput(text="Garbage date", timestamp="invalid-iso-string"),
    ]
    scores = [
        {"positive": 0.5, "negative": 0.1, "neutral": 0.4},
        {"positive": 0.5, "negative": 0.1, "neutral": 0.4},
    ]

    result = aggregate_sentiment(headlines, scores, as_of=as_of)
    assert result.headlines[0].weight == 1.0
    assert result.headlines[1].weight == 1.0


def test_future_timestamp_clamped_to_zero_delay() -> None:
    """Timestamp in the future relative to as_of has dt clamped to 0 -> weight=1.0."""
    as_of = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    headlines = [
        HeadlineInput(text="Future", timestamp="2026-08-21T12:00:00Z"),  # 24h into future
    ]
    scores = [{"positive": 0.6, "negative": 0.2, "neutral": 0.2}]

    result = aggregate_sentiment(headlines, scores, as_of=as_of)
    assert result.headlines[0].weight == 1.0


def test_string_as_of_support() -> None:
    """as_of passed as ISO-8601 string works equivalently to datetime."""
    headlines = [
        HeadlineInput(text="H1", timestamp="2026-08-19T12:00:00Z"),
    ]
    scores = [{"positive": 0.9, "negative": 0.05, "neutral": 0.05}]

    result = aggregate_sentiment(headlines, scores, as_of="2026-08-20T12:00:00Z")
    assert pytest.approx(result.headlines[0].weight, rel=1e-4) == 0.5


def test_all_neutral_probabilities_yield_zero_confidence() -> None:
    """If all headlines are 100% neutral, confidence and score are 0.0."""
    headlines = [HeadlineInput(text="Neutral")]
    scores = [{"positive": 0.0, "negative": 0.0, "neutral": 1.0}]

    result = aggregate_sentiment(headlines, scores)
    assert result.score == 0.0
    assert result.confidence == 0.0
    assert result.label == "neutral"


# =====================================================================
# FinBERTScorer Model & Inference Tests
# =====================================================================


def test_scorer_device_detection() -> None:
    """Scorer respects explicit device and detects CPU when specified."""
    scorer = FinBERTScorer(device="cpu", lazy=True)
    assert scorer.device_name == "cpu"
    assert scorer.vram_allocated_mb == 0.0
    assert scorer.vram_mb == 0.0


def test_scorer_preserves_id2label_mapping() -> None:
    """Scorer extracts probabilities strictly using model.config.id2label."""
    # Create a mock model with non-standard id2label ordering
    mock_pipeline = MagicMock()
    mock_model = MagicMock()
    # id2label mapping where 0=neutral, 1=positive, 2=negative
    mock_model.config.id2label = {0: "neutral", 1: "positive", 2: "negative"}
    mock_pipeline.model = mock_model

    mock_pipeline.return_value = [
        [
            {"label": "neutral", "score": 0.1},
            {"label": "positive", "score": 0.7},
            {"label": "negative", "score": 0.2},
        ]
    ]

    scorer = FinBERTScorer(device="cpu", lazy=True)
    scorer._pipeline = mock_pipeline
    scorer._loaded = True

    results = scorer.score_batch(["Quarterly profits up 50%"])
    assert len(results) == 1
    assert pytest.approx(results[0]["positive"]) == 0.7
    assert pytest.approx(results[0]["negative"]) == 0.2
    assert pytest.approx(results[0]["neutral"]) == 0.1


def test_scorer_truncates_long_inputs() -> None:
    """Headlines longer than 512 characters are truncated before pipeline forward pass."""
    mock_pipeline = MagicMock()
    mock_pipeline.return_value = [
        [
            {"label": "positive", "score": 0.5},
            {"label": "negative", "score": 0.3},
            {"label": "neutral", "score": 0.2},
        ]
    ]

    scorer = FinBERTScorer(device="cpu", lazy=True)
    scorer._pipeline = mock_pipeline
    scorer._loaded = True

    long_text = "A" * 1000
    scorer.score_batch([long_text])

    called_args = mock_pipeline.call_args[0][0]
    assert len(called_args[0]) == 512
    assert called_args[0] == "A" * 512


def test_scorer_empty_batch_handling() -> None:
    """Scorer gracefully handles empty batch without calling pipeline."""
    mock_pipeline = MagicMock()
    scorer = FinBERTScorer(device="cpu", lazy=True)
    scorer._pipeline = mock_pipeline
    scorer._loaded = True

    results = scorer.score_batch([])
    assert results == []
    mock_pipeline.assert_not_called()


def test_scorer_score_headlines_integration() -> None:
    """score_headlines orchestrates batch scoring and recency aggregation."""
    mock_pipeline = MagicMock()
    mock_pipeline.return_value = [
        [
            {"label": "positive", "score": 0.8},
            {"label": "negative", "score": 0.1},
            {"label": "neutral", "score": 0.1},
        ],
        [
            {"label": "positive", "score": 0.1},
            {"label": "negative", "score": 0.8},
            {"label": "neutral", "score": 0.1},
        ],
    ]

    scorer = FinBERTScorer(device="cpu", lazy=True)
    scorer._pipeline = mock_pipeline
    scorer._loaded = True

    headlines = [
        HeadlineInput(text="Profits surge", timestamp="2026-08-20T12:00:00Z"),
        HeadlineInput(text="Losses mount", timestamp="2026-08-19T12:00:00Z"),
    ]

    result = scorer.score_headlines(headlines, as_of="2026-08-20T12:00:00Z")

    assert isinstance(result, SentimentResult)
    assert result.headline_count == 2
    assert result.label == "positive"  # (1.0*0.7 + 0.5*(-0.7)) / 1.5 = 0.35 / 1.5 = +0.2333 >= 0.15
    assert result.device == "cpu"


def test_cuda_oom_falls_back_to_cpu() -> None:
    """When CUDA initialization triggers OOM, fallback to CPU device gracefully."""
    mock_cpu_pipeline = MagicMock()
    with (
        patch("torch.cuda.is_available", return_value=True),
        patch(
            "forecasting_agent.sentiment_server.scorer.pipeline",
            side_effect=[torch.cuda.OutOfMemoryError("CUDA out of memory"), mock_cpu_pipeline],
        ),
        patch("torch.set_num_threads") as mock_set_threads,
    ):
        scorer = FinBERTScorer(device="cuda", lazy=False)
        assert scorer.device_name == "cpu"
        assert scorer._pipeline is mock_cpu_pipeline
        mock_set_threads.assert_called_with(6)
