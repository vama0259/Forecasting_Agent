"""FastMCP sentiment server with FinBERT scoring and event-loop thread offloading."""

import asyncio
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from forecasting_agent.sentiment_server.aggregator import HeadlineInput
from forecasting_agent.sentiment_server.scorer import FinBERTScorer

logger = logging.getLogger(__name__)

mcp = FastMCP("sentiment")
app = mcp
scorer = FinBERTScorer()


@mcp.tool()
async def score_sentiment(
    headlines: list[dict[str, Any]],
    as_of: str | None = None,
) -> dict[str, Any]:
    """Score sentiment for a list of news headlines using FinBERT with recency decay aggregation.

    PyTorch scoring is offloaded to a worker thread via asyncio.to_thread to keep the FastMCP event loop responsive.
    """
    try:
        parsed_headlines = [HeadlineInput.model_validate(h) for h in headlines]
        res = await asyncio.to_thread(scorer.score_headlines, parsed_headlines, as_of)
        return res.model_dump()
    except Exception as exc:
        logger.warning("FinBERT sentiment scoring failed: %s", exc, exc_info=True)
        return {
            "score": 0.0,
            "label": "neutral",
            "confidence": 0.0,
            "headline_count": 0,
            "headlines": [],
            "device": scorer.device_name,
            "degraded": True,
            "error": str(exc),
        }


@mcp.tool()
def health() -> dict[str, Any]:
    """Return health status and resource consumption metrics for the FinBERT sentiment server."""
    return {
        "status": "healthy",
        "model": "ProsusAI/finbert",
        "device": scorer.device_name,
        "vram_allocated_mb": scorer.vram_allocated_mb,
    }


def main() -> None:
    """Run FastMCP sentiment server."""
    mcp.run()


if __name__ == "__main__":
    main()


__all__ = [
    "app",
    "health",
    "main",
    "mcp",
    "score_sentiment",
    "scorer",
]
