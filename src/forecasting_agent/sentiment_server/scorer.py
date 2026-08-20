"""FinBERT model loader and inference engine with CUDA/CPU fallback."""

import logging
from datetime import datetime
from typing import Any

import torch
from transformers import pipeline

from forecasting_agent.sentiment_server.aggregator import (
    HeadlineInput,
    SentimentResult,
    aggregate_sentiment,
)

logger = logging.getLogger(__name__)


class FinBERTScorer:
    """FinBERT financial sentiment scoring engine with GPU acceleration and CPU fallback."""

    def __init__(
        self,
        device: str | None = None,
        model_name: str = "ProsusAI/finbert",
        lazy: bool = False,
    ) -> None:
        self.model_name = model_name
        self._requested_device = device
        self._device = "cpu"
        self._pipeline: Any = None
        self._loaded = False

        if not lazy:
            self._ensure_loaded()

    def _ensure_loaded(self) -> None:
        """Load transformers pipeline with automatic CUDA fallback to CPU."""
        if self._loaded and self._pipeline is not None:
            return

        target_device = self._requested_device
        if target_device is None:
            target_device = "cuda" if torch.cuda.is_available() else "cpu"

        if target_device.startswith("cuda") and torch.cuda.is_available():
            try:
                logger.info("Attempting to load FinBERT pipeline on CUDA device...")
                self._pipeline = pipeline(
                    "text-classification",
                    model=self.model_name,
                    device=target_device,
                    top_k=None,
                )
                self._device = target_device
                self._loaded = True
                logger.info("Successfully loaded FinBERT on %s", self._device)
                return
            except (torch.cuda.OutOfMemoryError, RuntimeError, Exception) as exc:
                logger.warning(
                    "Failed to load FinBERT on CUDA device (%s): %s. Falling back to CPU.",
                    target_device,
                    exc,
                )

        # CPU fallback / default
        torch.set_num_threads(6)
        logger.info("Loading FinBERT pipeline on CPU (6 threads)...")
        self._pipeline = pipeline(
            "text-classification",
            model=self.model_name,
            device="cpu",
            top_k=None,
        )
        self._device = "cpu"
        self._loaded = True
        logger.info("Successfully loaded FinBERT on CPU.")

    @property
    def device_name(self) -> str:
        """Return active device name ('cuda', 'cuda:0', or 'cpu')."""
        return self._device

    @property
    def vram_allocated_mb(self) -> float:
        """Return current VRAM allocated in MB if on CUDA, else 0.0."""
        if self._device.startswith("cuda") and torch.cuda.is_available():
            try:
                return round(torch.cuda.memory_allocated() / (1024.0 * 1024.0), 2)
            except Exception:
                return 0.0
        return 0.0

    @property
    def vram_mb(self) -> float:
        """Alias for vram_allocated_mb."""
        return self.vram_allocated_mb

    def score_batch(self, texts: list[str]) -> list[dict[str, float]]:
        """Score a list of text snippets, returning probabilities for positive, negative, neutral.

        Texts longer than 512 characters are truncated to guarantee bounded latency.
        Extracts probabilities strictly according to model label mappings.
        """
        if not texts:
            return []

        self._ensure_loaded()
        truncated_texts = [text[:512] for text in texts]

        raw_outputs = self._pipeline(truncated_texts)

        results: list[dict[str, float]] = []
        for output in raw_outputs:
            scores = {"positive": 0.0, "negative": 0.0, "neutral": 0.0}
            if isinstance(output, list):
                for item in output:
                    label = str(item.get("label", "")).lower()
                    score = float(item.get("score", 0.0))
                    if label in scores:
                        scores[label] = score
            elif isinstance(output, dict):
                label = str(output.get("label", "")).lower()
                score = float(output.get("score", 0.0))
                if label in scores:
                    scores[label] = score
            results.append(scores)

        return results

    def score_headlines(
        self,
        headlines: list[HeadlineInput],
        as_of: datetime | str | None = None,
    ) -> SentimentResult:
        """Score a list of structured headlines and aggregate with recency decay."""
        if not headlines:
            return aggregate_sentiment([], [], as_of=as_of, device=self.device_name)

        texts = [h.text for h in headlines]
        scores = self.score_batch(texts)
        return aggregate_sentiment(headlines, scores, as_of=as_of, device=self.device_name)
