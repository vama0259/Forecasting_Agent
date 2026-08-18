"""Parquet file cache for OHLCV market data."""

from datetime import date
from pathlib import Path

import pandas as pd

from forecasting_agent.data_server.contracts import OHLCVBar


class ParquetCache:
    """File-based cache storing OHLCV bar series as Parquet files."""

    def __init__(self, cache_dir: str = "data/cache/ohlcv") -> None:
        """Initialize ParquetCache and ensure cache directory exists.

        Args:
            cache_dir: Directory path where Parquet cache files are stored.
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_file_path(self, symbol: str, market: str) -> Path:
        """Get the filesystem path for a given symbol and market cache file."""
        safe_symbol = symbol.replace("/", "_")
        safe_market = market.replace("/", "_")
        return self.cache_dir / f"{safe_market}_{safe_symbol}.parquet"

    def get(self, symbol: str, market: str) -> list[OHLCVBar] | None:
        """Retrieve and deserialize cached OHLCV bars for symbol and market.

        Args:
            symbol: Ticker symbol (e.g. 'RELIANCE.NS').
            market: Market identifier (e.g. 'NSE').

        Returns:
            List of OHLCVBar instances if cache exists, otherwise None.
        """
        file_path = self._get_file_path(symbol, market)
        if not file_path.exists() or not file_path.is_file():
            return None

        try:
            df = pd.read_parquet(file_path)
        except (ValueError, OSError, RuntimeError):
            return None

        records = df.to_dict(orient="records")
        return [OHLCVBar.model_validate(r) for r in records]

    def put(self, symbol: str, market: str, bars: list[OHLCVBar]) -> None:
        """Serialize and persist OHLCV bars to a Parquet file.

        Args:
            symbol: Ticker symbol (e.g. 'RELIANCE.NS').
            market: Market identifier (e.g. 'NSE').
            bars: List of OHLCVBar instances to cache.
        """
        file_path = self._get_file_path(symbol, market)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        if not bars:
            df = pd.DataFrame(
                columns=[
                    "date",
                    "open",
                    "high",
                    "low",
                    "close",
                    "volume",
                    "is_outlier",
                    "is_circuit_locked",
                ]
            )
        else:
            records = [b.model_dump() for b in bars]
            df = pd.DataFrame(records)

        df.to_parquet(file_path, index=False)

    def covers_range(self, symbol: str, market: str, start: date, end: date) -> bool:
        """Check whether the cached series for symbol/market fully brackets [start, end].

        Args:
            symbol: Ticker symbol (e.g. 'RELIANCE.NS').
            market: Market identifier (e.g. 'NSE').
            start: Requested range start (inclusive).
            end: Requested range end (inclusive).

        Returns:
            True only if a cached series exists and its earliest bar is on or before
            `start` and its latest bar is on or after `end` -- a cache holding a recent
            window must not be treated as covering an unrelated, older requested range.
        """
        bars = self.get(symbol, market)
        if not bars:
            return False

        cached_min = min(b.date for b in bars)
        cached_max = max(b.date for b in bars)
        return cached_min <= start and cached_max >= end

    def is_stale(
        self,
        symbol: str,
        market: str,
        max_staleness_days: int = 3,
    ) -> bool:
        """Check if cached data is missing or older than the staleness threshold.

        Args:
            symbol: Ticker symbol (e.g. 'RELIANCE.NS').
            market: Market identifier (e.g. 'NSE').
            max_staleness_days: Maximum allowable age in days before cache is stale.

        Returns:
            True if no cached data exists or if the most recent cached bar's date
            is more than max_staleness_days before today; False otherwise.
        """
        bars = self.get(symbol, market)
        if not bars:
            return True

        latest_date = max(b.date for b in bars)
        today = date.today()  # noqa: DTZ011
        return (today - latest_date).days > max_staleness_days


__all__ = ["ParquetCache"]
