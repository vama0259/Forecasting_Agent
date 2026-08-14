"""NSE & BSE equity market plugin wrapping yfinance."""

from datetime import date

import pandas as pd  # type: ignore[import-untyped]
import yfinance as yf  # type: ignore[import-untyped]

from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.plugins.base import MarketPlugin


class NsePlugin(MarketPlugin):
    """Market plugin for Indian equities (NSE & BSE) using yfinance."""

    @property
    def symbol_pattern(self) -> str:
        """Regex pattern matching valid NSE/BSE symbols."""
        return r"^.+\.(NS|BO)$"

    def supports(self, symbol: str) -> bool:
        """Check whether symbol has NSE or BSE exchange suffix."""
        return symbol.endswith((".NS", ".BO"))

    def fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]:
        """Fetch daily OHLCV bars for the symbol via yfinance."""
        df = yf.download(symbol, start=start, end=end)
        if df is None or df.empty:
            return []

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        bars: list[OHLCVBar] = []
        for idx, row in df.iterrows():
            bar_date = idx.date() if hasattr(idx, "date") else pd.to_datetime(idx).date()
            bars.append(
                OHLCVBar(
                    date=bar_date,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=int(row["Volume"]),
                    is_outlier=False,
                    is_circuit_locked=False,
                )
            )

        return bars


__all__ = ["NsePlugin"]
