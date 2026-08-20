"""FinBERT Sentiment Analysis and Recency Decay Aggregator Server."""

from forecasting_agent.sentiment_server.aggregator import (
    HeadlineInput,
    HeadlineScore,
    SentimentResult,
    aggregate_sentiment,
)
from forecasting_agent.sentiment_server.scorer import FinBERTScorer
from forecasting_agent.sentiment_server.server import health, mcp, score_sentiment

__all__ = [
    "FinBERTScorer",
    "HeadlineInput",
    "HeadlineScore",
    "SentimentResult",
    "aggregate_sentiment",
    "health",
    "mcp",
    "score_sentiment",
]
