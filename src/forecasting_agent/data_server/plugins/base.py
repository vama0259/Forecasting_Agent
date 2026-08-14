"""Base contract for market data plugins."""

from abc import ABC, abstractmethod
from datetime import date

from forecasting_agent.data_server.contracts import OHLCVBar


class MarketPlugin(ABC):
    """Abstract base class for all market data source plugins."""

    @property
    @abstractmethod
    def symbol_pattern(self) -> str:
        """Regex pattern matching valid symbols for this plugin."""

    @abstractmethod
    def supports(self, symbol: str) -> bool:
        """Check whether this plugin supports the given symbol."""

    @abstractmethod
    def fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]:
        """Fetch daily OHLCV bars for the symbol across the given date range."""


__all__ = ["MarketPlugin"]
