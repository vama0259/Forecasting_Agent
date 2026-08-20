"""Unit and integration tests for FastMCP FinBERT sentiment server."""

from unittest.mock import AsyncMock, patch

import pytest

from forecasting_agent.sentiment_server.aggregator import SentimentResult
from forecasting_agent.sentiment_server.server import health, main, mcp, score_sentiment, scorer


def test_health_tool_returns_healthy_status_and_metadata() -> None:
    """health() tool returns healthy status, model identifier, device, and VRAM metric."""
    result = health()
    assert isinstance(result, dict)
    assert result["status"] == "healthy"
    assert result["model"] == "ProsusAI/finbert"
    assert "device" in result
    assert result["device"] in ("cuda", "cpu") or result["device"].startswith("cuda:")
    assert isinstance(result["vram_allocated_mb"], float)
    assert result["vram_allocated_mb"] >= 0.0


@pytest.mark.asyncio
async def test_score_sentiment_success() -> None:
    """score_sentiment successfully parses headline dicts and returns aggregated sentiment."""
    mock_result = SentimentResult(
        score=0.75,
        label="positive",
        confidence=0.85,
        headline_count=1,
        headlines=[],
        device="cpu",
        degraded=False,
    )

    with patch.object(scorer, "score_headlines", return_value=mock_result) as mock_score:
        headlines = [
            {"text": "TCS reports 25% revenue growth", "timestamp": "2026-08-20T10:00:00Z"},
        ]
        res = await score_sentiment(headlines=headlines, as_of="2026-08-20T12:00:00Z")

        assert isinstance(res, dict)
        assert res["score"] == 0.75
        assert res["label"] == "positive"
        assert res["confidence"] == 0.85
        assert res["headline_count"] == 1
        assert res["degraded"] is False
        mock_score.assert_called_once()


@pytest.mark.asyncio
async def test_score_sentiment_thread_offloading() -> None:
    """score_sentiment offloads blocking scoring to asyncio.to_thread."""
    mock_result = SentimentResult(
        score=0.0,
        label="neutral",
        confidence=0.0,
        headline_count=0,
        headlines=[],
        device=scorer.device_name,
        degraded=False,
    )

    with patch("asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
        mock_to_thread.return_value = mock_result
        headlines = [{"text": "Neutral market opening", "timestamp": None}]
        res = await score_sentiment(headlines=headlines)

        assert res["degraded"] is False
        mock_to_thread.assert_awaited_once()


@pytest.mark.asyncio
async def test_score_sentiment_empty_input() -> None:
    """Empty headline list returns neutral non-degraded response."""
    res = await score_sentiment(headlines=[])
    assert isinstance(res, dict)
    assert res["score"] == 0.0
    assert res["label"] == "neutral"
    assert res["confidence"] == 0.0
    assert res["headline_count"] == 0
    assert res["headlines"] == []
    assert res["degraded"] is False


@pytest.mark.asyncio
async def test_score_sentiment_defensive_error_handling() -> None:
    """Exception during scoring returns degraded payload with error message."""
    with patch.object(scorer, "score_headlines", side_effect=RuntimeError("CUDA out of memory")):
        headlines = [{"text": "Booming market rally", "timestamp": "2026-08-20T10:00:00Z"}]
        res = await score_sentiment(headlines=headlines)

        assert isinstance(res, dict)
        assert res["score"] == 0.0
        assert res["label"] == "neutral"
        assert res["confidence"] == 0.0
        assert res["headline_count"] == 0
        assert res["headlines"] == []
        assert res["degraded"] is True
        assert "CUDA out of memory" in res["error"]


@pytest.mark.asyncio
async def test_score_sentiment_malformed_headline_dict_handling() -> None:
    """Malformed headline dictionary triggers defensive degraded response."""
    headlines = [{"invalid_key": 123}]  # Missing required 'text' field
    res = await score_sentiment(headlines=headlines)

    assert isinstance(res, dict)
    assert res["degraded"] is True
    assert "error" in res


def test_mcp_tool_registration() -> None:
    """mcp instance registers score_sentiment and health tools."""
    assert mcp.name == "sentiment"


def test_server_main_entry_point() -> None:
    """main() entry point runs FastMCP server."""
    with patch.object(mcp, "run") as mock_run:
        main()
        mock_run.assert_called_once()
