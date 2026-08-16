# Fallback market plugin executing an ordered chain of plugins on failure.

import logging
from datetime import date

from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.plugins.base import MarketPlugin

logger = logging.getLogger(__name__)


class FallbackPlugin(MarketPlugin):
    # Fallback plugin executing an ordered list of market plugins with failure logging.

    def __init__(self, plugins: list[MarketPlugin]) -> None:
        # Initializes FallbackPlugin with an ordered list of market plugins.
        self._plugins = list(plugins)

    @property
    def symbol_pattern(self) -> str:
        # Returns symbol regex pattern of the primary market plugin.
        return self._plugins[0].symbol_pattern

    def supports(self, symbol: str) -> bool:
        # Checks whether any plugin in the list supports the given symbol.
        return any(p.supports(symbol) for p in self._plugins)

    def fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]:
        # Fetches daily OHLCV bars for symbol between start and end by trying plugins in order.
        last_exc: Exception | None = None
        for plugin in self._plugins:
            try:
                return plugin.fetch(symbol, start, end)
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Plugin %s failed for symbol %s: %s",
                    type(plugin).__name__,
                    symbol,
                    exc,
                )
        if last_exc is not None:
            raise last_exc
        return []


__all__ = ["FallbackPlugin"]
