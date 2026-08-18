# Market data MCP server exposing standard tool interface and observation archive hook.

import json
import logging
from datetime import date
from typing import Any

import yfinance as yf  # type: ignore[import-untyped]
from mcp.server.fastmcp import FastMCP

from forecasting_agent.archive.errors import ArchiveWriteError
from forecasting_agent.archive.store import ObservationStore
from forecasting_agent.data_server.cache import ParquetCache
from forecasting_agent.data_server.cleaner import flag_circuit_locked, hampel_clip
from forecasting_agent.data_server.connector_registry import get_connector_registry
from forecasting_agent.data_server.contracts import (
    FlowsResponse,
    FnOChainResponse,
    MarketMeta,
    MicrostructureResponse,
    OHLCVBar,
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


def _serialize_bars(bars: list[OHLCVBar]) -> bytes:
    # Serializes list of OHLCV bars to JSON bytes for archive storage.
    return json.dumps([b.model_dump(mode="json") for b in bars]).encode("utf-8")


@app.tool()
def list_markets() -> list[MarketMeta]:
    # List all supported market identifiers and metadata.
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
    # Resolve a symbol within a market to its canonical symbol metadata.
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


def _fetch_raw_ohlcv(
    plugin: Any,
    cache: ParquetCache,
    symbol: str,
    market: str,
    start_date: date,
    end_date: date,
) -> tuple[list[OHLCVBar], bool, bool]:
    cached_bars = cache.get(symbol, market)
    is_cache_stale = cache.is_stale(symbol, market)
    cache_covers_request = cache.covers_range(symbol, market, start_date, end_date)

    def in_range(bars: list[OHLCVBar]) -> list[OHLCVBar]:
        return [b for b in bars if start_date <= b.date <= end_date]

    if cached_bars is not None and not is_cache_stale and cache_covers_request:
        return in_range(cached_bars), False, False

    try:
        fetched_bars = plugin.fetch(symbol, start=start_date, end=end_date)
        if fetched_bars:
            return in_range(fetched_bars), False, True
        if cached_bars is not None and cache_covers_request:
            return in_range(cached_bars), True, False
        return [], False, False
    except Exception:
        if cached_bars is not None and cache_covers_request:
            return in_range(cached_bars), True, False
        raise


def _archive_ohlcv_snapshot(market: str, symbol: str, bars: list[OHLCVBar]) -> None:
    try:
        ObservationStore().write(
            source=f"ohlcv:{market.upper()}:{symbol}",
            observed_on=date.today(),  # noqa: DTZ011 -- matches is_stale()'s existing precedent at cache.py
            content=_serialize_bars(bars),
        )
    except ArchiveWriteError:
        logger.exception("Failed to archive OHLCV snapshot for %s/%s", market, symbol)


@app.tool()
def fetch_ohlcv(
    symbol: str,
    market: str,
    start: str,
    end: str,
    as_of: str | None = None,
) -> OHLCVResponse:
    # Fetch, clean, normalize, and filter daily OHLCV bars for a symbol.
    plugin = resolve(market)
    cache = ParquetCache()
    start_date = date.fromisoformat(start) if isinstance(start, str) else start
    end_date = date.fromisoformat(end) if isinstance(end, str) else end

    raw_bars, data_stale, freshly_fetched = _fetch_raw_ohlcv(plugin, cache, symbol, market, start_date, end_date)

    cleaned_bars = hampel_clip(raw_bars)
    cleaned_bars = flag_circuit_locked(cleaned_bars)
    normalized_bars = align_calendar(cleaned_bars)

    if freshly_fetched:
        cache.put(symbol, market, normalized_bars)
        _archive_ohlcv_snapshot(market, symbol, normalized_bars)

    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    filtered_bars = filter_as_of(normalized_bars, as_of=as_of_date)

    return OHLCVResponse(
        symbol=symbol,
        market=market.upper(),
        bars=filtered_bars,
        data_stale=data_stale,
    )


def _validate_fno_as_of(as_of: str | None) -> None:
    if as_of is not None:
        as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
        today = date.today()  # noqa: DTZ011
        if as_of_date > today:
            raise LeakageError(f"as_of date {as_of_date} is in the future relative to today ({today})")


def _populate_option_side(df: Any, strikes_map: dict[float, dict[str, Any]], prefix: str) -> None:
    if df is None or df.empty:
        return
    ltp_key = f"{prefix}_ltp"
    oi_key = f"{prefix}_oi"
    for _, row in df.iterrows():
        strike = float(row.get("strike", 0.0))
        if strike <= 0:
            continue
        strikes_map.setdefault(strike, {})[ltp_key] = float(row.get("lastPrice", 0.0) or 0.0)
        strikes_map[strike][oi_key] = int(row.get("openInterest", 0) or 0)


@app.tool()
def fetch_option_chain(
    underlying: str,
    expiry: str | None = None,
    as_of: str | None = None,
) -> FnOChainResponse:
    """Fetch option chain for an underlying and expiry (defaults to nearest available expiry cycle if omitted)."""
    _validate_fno_as_of(as_of)

    ticker_symbol = underlying
    if not ticker_symbol.endswith((".NS", ".BO")) and not ticker_symbol.startswith("^"):
        ticker_symbol = f"{underlying}.NS"

    strikes_map: dict[float, dict[str, Any]] = {}
    resolved_expiry_date = None
    try:
        ticker = yf.Ticker(ticker_symbol)
        options = getattr(ticker, "options", [])
        if expiry:
            target_expiry = expiry
        elif options:
            target_expiry = options[0]
        else:
            target_expiry = str(as_of or date.today())  # noqa: DTZ011

        resolved_expiry_date = date.fromisoformat(target_expiry)
        chain = ticker.option_chain(target_expiry) if target_expiry in options else ticker.option_chain()
        _populate_option_side(chain.calls, strikes_map, "call")
        _populate_option_side(chain.puts, strikes_map, "put")
    except Exception as exc:
        logger.debug("Failed to fetch option chain for %s (%s): %s", ticker_symbol, expiry, exc)

    strikes: list[StrikeData] = [
        StrikeData(
            strike_price=strike_price,
            call_oi=max(0, info.get("call_oi", 0)),
            put_oi=max(0, info.get("put_oi", 0)),
            call_ltp=max(0.0, info.get("call_ltp", 0.0)),
            put_ltp=max(0.0, info.get("put_ltp", 0.0)),
        )
        for strike_price, info in sorted(strikes_map.items())
    ]

    return FnOChainResponse(
        underlying=underlying,
        expiry=resolved_expiry_date or (date.fromisoformat(as_of) if as_of else date.today()),  # noqa: DTZ011
        strikes=strikes,
        data_stale=False,
    )


@app.tool()
def fetch_flows(observed_on: str, as_of: str | None = None) -> FlowsResponse:
    # Fetch participant-wise F&O open interest flow records for a given date.
    connector = get_connector_registry().resolve("flows")
    obs_date = date.fromisoformat(observed_on) if isinstance(observed_on, str) else observed_on
    records = connector.fetch(obs_date)
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    filtered = filter_as_of(records, as_of=as_of_date, key=lambda r: r.observed_on)
    return FlowsResponse(observed_on=obs_date, records=filtered)


@app.tool()
def fetch_microstructure(observed_on: str, as_of: str | None = None) -> MicrostructureResponse:
    # Fetch delivery percentage and bulk/block deal records for a given date.
    connector = get_connector_registry().resolve("microstructure")
    obs_date = date.fromisoformat(observed_on) if isinstance(observed_on, str) else observed_on
    response: MicrostructureResponse = connector.fetch(obs_date)
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    response.delivery = filter_as_of(response.delivery, as_of=as_of_date, key=lambda r: r.observed_on)
    response.bulk_deals = filter_as_of(response.bulk_deals, as_of=as_of_date, key=lambda r: r.observed_on)
    response.block_deals = filter_as_of(response.block_deals, as_of=as_of_date, key=lambda r: r.observed_on)
    return response


if __name__ == "__main__":
    app.run()


__all__ = [
    "app",
    "fetch_flows",
    "fetch_microstructure",
    "fetch_ohlcv",
    "fetch_option_chain",
    "list_markets",
    "resolve_symbol",
]
