"""Market data MCP server exposing standard tool interface."""

import logging
from datetime import date
from typing import Any

import yfinance as yf  # type: ignore[import-untyped]
from mcp.server.fastmcp import FastMCP

from forecasting_agent.data_server.cache import ParquetCache
from forecasting_agent.data_server.cleaner import flag_circuit_locked, hampel_clip
from forecasting_agent.data_server.contracts import (
    FnOChainResponse,
    MarketMeta,
    OHLCVResponse,
    StrikeData,
    SymbolMeta,
)
from forecasting_agent.data_server.normalizer import align_calendar
from forecasting_agent.data_server.point_in_time import LeakageError, filter_as_of
from forecasting_agent.data_server.registry import get_registry, resolve

logger = logging.getLogger(__name__)

app = FastMCP("market-data")

MARKET_METADATA: dict[str, dict[str, str]] = {
    "NSE": {
        "display_name": "National Stock Exchange",
        "timezone": "Asia/Kolkata",
    },
    "BSE": {
        "display_name": "Bombay Stock Exchange",
        "timezone": "Asia/Kolkata",
    },
}


@app.tool()
def list_markets() -> list[MarketMeta]:
    """List all supported market identifiers and metadata."""
    registered = get_registry().list_markets()
    markets: list[MarketMeta] = []
    for mkt in registered:
        meta = MARKET_METADATA.get(
            mkt,
            {"display_name": f"{mkt} Market", "timezone": "UTC"},
        )
        markets.append(
            MarketMeta(
                market=mkt,
                display_name=meta["display_name"],
                timezone=meta["timezone"],
            )
        )
    return markets


@app.tool()
def resolve_symbol(symbol: str, market: str) -> SymbolMeta:
    """Resolve a symbol within a market to its canonical symbol metadata."""
    plugin = resolve(market)

    suffix = ""
    for sfx in [".NS", ".BO"]:
        if symbol.endswith(sfx):
            suffix = sfx
            break

    if not suffix:
        if market.upper() == "NSE":
            suffix = ".NS"
        elif market.upper() == "BSE":
            suffix = ".BO"

    test_symbol = symbol if suffix and symbol.endswith(suffix) else f"{symbol}{suffix}"
    if not plugin.supports(symbol) and not plugin.supports(test_symbol):
        raise ValueError(f"Symbol '{symbol}' is not supported by market '{market}' plugin")

    return SymbolMeta(
        symbol=symbol,
        market=market.upper(),
        exchange_suffix=suffix,
    )


@app.tool()
def fetch_ohlcv(
    symbol: str,
    market: str,
    start: str,
    end: str,
    as_of: str | None = None,
) -> OHLCVResponse:
    """Fetch, clean, normalize, and filter daily OHLCV bars for a symbol."""
    # 1. Resolve plugin
    plugin = resolve(market)

    # 2. Check cache; fetch from plugin only on cache miss or when stale
    cache = ParquetCache()
    cached_bars = cache.get(symbol, market)
    is_cache_stale = cache.is_stale(symbol, market)

    data_stale = False
    freshly_fetched = False

    if cached_bars is not None and not is_cache_stale:
        raw_bars = cached_bars
    else:
        start_date = date.fromisoformat(start) if isinstance(start, str) else start
        end_date = date.fromisoformat(end) if isinstance(end, str) else end
        try:
            fetched_bars = plugin.fetch(symbol, start=start_date, end=end_date)
            if fetched_bars:
                raw_bars = fetched_bars
                freshly_fetched = True
                data_stale = False
            elif cached_bars is not None:
                raw_bars = cached_bars
                data_stale = True
            else:
                raw_bars = []
        except Exception:
            if cached_bars is not None:
                raw_bars = cached_bars
                data_stale = True
            else:
                raise

    # 3. Outlier cleaning
    cleaned_bars = hampel_clip(raw_bars)
    cleaned_bars = flag_circuit_locked(cleaned_bars)

    # 4. Calendar alignment
    normalized_bars = align_calendar(cleaned_bars)

    # 7. Cache freshly fetched (pre-filter, cleaned+normalized) result
    if freshly_fetched:
        cache.put(symbol, market, normalized_bars)

    # 5. Point-in-time filtering (MUST run last)
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    filtered_bars = filter_as_of(normalized_bars, as_of=as_of_date)

    # 6. Wrap in OHLCVResponse
    return OHLCVResponse(
        symbol=symbol,
        market=market.upper(),
        bars=filtered_bars,
        data_stale=data_stale,
    )


@app.tool()
def fetch_option_chain(
    underlying: str,
    expiry: str,
    as_of: str | None = None,
) -> FnOChainResponse:
    """Fetch option chain for an underlying and expiry."""
    expiry_date = date.fromisoformat(expiry) if isinstance(expiry, str) else expiry

    if as_of is not None:
        as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
        today = date.today()  # noqa: DTZ011
        if as_of_date > today:
            raise LeakageError(f"as_of date {as_of_date} is in the future relative to today ({today})")

    ticker_symbol = underlying
    if not ticker_symbol.endswith((".NS", ".BO")) and not ticker_symbol.startswith("^"):
        ticker_symbol = f"{underlying}.NS"

    strikes_map: dict[float, dict[str, Any]] = {}
    try:
        ticker = yf.Ticker(ticker_symbol)
        chain = ticker.option_chain(expiry)
        calls_df = chain.calls
        puts_df = chain.puts

        if calls_df is not None and not calls_df.empty:
            for _, row in calls_df.iterrows():
                strike = float(row.get("strike", 0.0))
                if strike <= 0:
                    continue
                strikes_map.setdefault(strike, {})["call_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                strikes_map[strike]["call_oi"] = int(row.get("openInterest", 0) or 0)

        if puts_df is not None and not puts_df.empty:
            for _, row in puts_df.iterrows():
                strike = float(row.get("strike", 0.0))
                if strike <= 0:
                    continue
                strikes_map.setdefault(strike, {})["put_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                strikes_map[strike]["put_oi"] = int(row.get("openInterest", 0) or 0)
    except Exception as exc:
        logger.debug("Failed to fetch option chain for %s (%s): %s", ticker_symbol, expiry, exc)

    strikes: list[StrikeData] = []
    for strike_price in sorted(strikes_map.keys()):
        info = strikes_map[strike_price]
        strikes.append(
            StrikeData(
                strike_price=strike_price,
                call_oi=max(0, info.get("call_oi", 0)),
                put_oi=max(0, info.get("put_oi", 0)),
                call_ltp=max(0.0, info.get("call_ltp", 0.0)),
                put_ltp=max(0.0, info.get("put_ltp", 0.0)),
            )
        )

    return FnOChainResponse(
        underlying=underlying,
        expiry=expiry_date,
        strikes=strikes,
        data_stale=False,
    )


if __name__ == "__main__":
    app.run()


__all__ = [
    "app",
    "fetch_ohlcv",
    "fetch_option_chain",
    "list_markets",
    "resolve_symbol",
]
