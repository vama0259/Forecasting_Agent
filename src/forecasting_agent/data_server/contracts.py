"""Data contracts and Pydantic v2 schemas for market data server."""

from datetime import date

from pydantic import BaseModel, Field


class MarketMeta(BaseModel):
    """Metadata describing a supported market."""

    market: str
    display_name: str
    timezone: str


class SymbolMeta(BaseModel):
    """Metadata describing a tradable symbol."""

    symbol: str
    market: str
    exchange_suffix: str = ""


class OHLCVBar(BaseModel):
    """Single OHLCV bar representation."""

    date: date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: int = Field(ge=0)
    is_outlier: bool = False
    is_circuit_locked: bool = False


class OHLCVResponse(BaseModel):
    """Response containing OHLCV bars for a symbol."""

    symbol: str
    market: str
    bars: list[OHLCVBar] = Field(default_factory=list)
    data_stale: bool = False


class StrikeData(BaseModel):
    """Strike-level derivative information."""

    strike_price: float = Field(gt=0)
    call_oi: int = Field(default=0, ge=0)
    put_oi: int = Field(default=0, ge=0)
    call_ltp: float = Field(default=0.0, ge=0.0)
    put_ltp: float = Field(default=0.0, ge=0.0)


class FnOChainResponse(BaseModel):
    """Response containing futures & options chain data."""

    underlying: str
    expiry: date
    strikes: list[StrikeData] = Field(default_factory=list)
    data_stale: bool = False


__all__ = [
    "FnOChainResponse",
    "MarketMeta",
    "OHLCVBar",
    "OHLCVResponse",
    "StrikeData",
    "SymbolMeta",
]
