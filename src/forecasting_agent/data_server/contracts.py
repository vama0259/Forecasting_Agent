# Data contracts and Pydantic v2 schemas for market data server.

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


# Metadata describing a supported market.
class MarketMeta(BaseModel):
    market: str
    display_name: str
    timezone: str


# Metadata describing a tradable symbol.
class SymbolMeta(BaseModel):
    symbol: str
    market: str
    exchange_suffix: str = ""


# Single OHLCV bar representation.
class OHLCVBar(BaseModel):
    date: date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: int = Field(ge=0)
    is_outlier: bool = False
    is_circuit_locked: bool = False


# Response containing OHLCV bars for a symbol.
class OHLCVResponse(BaseModel):
    symbol: str
    market: str
    bars: list[OHLCVBar] = Field(default_factory=list)
    data_stale: bool = False


# Strike-level derivative information.
class StrikeData(BaseModel):
    strike_price: float = Field(gt=0)
    call_oi: int = Field(default=0, ge=0)
    put_oi: int = Field(default=0, ge=0)
    call_ltp: float = Field(default=0.0, ge=0.0)
    put_ltp: float = Field(default=0.0, ge=0.0)


# Response containing futures & options chain data.
class FnOChainResponse(BaseModel):
    underlying: str
    expiry: date
    strikes: list[StrikeData] = Field(default_factory=list)
    data_stale: bool = False


# Participant-wise open interest derivative flow record.
class FlowRecord(BaseModel):
    observed_on: date
    participant: Literal["Client", "DII", "FII", "Pro", "TOTAL"]
    future_index_long: int = Field(ge=0)
    future_index_short: int = Field(ge=0)
    future_stock_long: int = Field(ge=0)
    future_stock_short: int = Field(ge=0)
    option_index_call_long: int = Field(ge=0)
    option_index_put_long: int = Field(ge=0)
    option_index_call_short: int = Field(ge=0)
    option_index_put_short: int = Field(ge=0)
    option_stock_call_long: int = Field(ge=0)
    option_stock_put_long: int = Field(ge=0)
    option_stock_call_short: int = Field(ge=0)
    option_stock_put_short: int = Field(ge=0)
    total_long_contracts: int = Field(ge=0)
    total_short_contracts: int = Field(ge=0)


# Security-wise delivery quantity and percentage record.
class DeliveryRecord(BaseModel):
    observed_on: date
    symbol: str
    series: str
    quantity_traded: int = Field(ge=0)
    deliverable_quantity: int = Field(ge=0)
    delivery_pct: float = Field(ge=0.0, le=100.0)


# Bulk deal execution record.
class BulkDealRecord(BaseModel):
    observed_on: date
    symbol: str
    client_name: str
    buy_sell: Literal["BUY", "SELL"]
    quantity: int = Field(ge=0)
    price: float = Field(gt=0)


# Block deal execution record.
class BlockDealRecord(BaseModel):
    observed_on: date
    symbol: str
    client_name: str
    buy_sell: Literal["BUY", "SELL"]
    quantity: int = Field(ge=0)
    price: float = Field(gt=0)


# Response containing delivery and deal microstructure records.
class MicrostructureResponse(BaseModel):
    observed_on: date
    delivery: list[DeliveryRecord] = Field(default_factory=list)
    bulk_deals: list[BulkDealRecord] = Field(default_factory=list)
    block_deals: list[BlockDealRecord] = Field(default_factory=list)
    coverage_note: str | None = None


# Response containing participant-wise derivative flow records.
class FlowsResponse(BaseModel):
    observed_on: date
    records: list[FlowRecord] = Field(default_factory=list)


__all__ = [
    "BlockDealRecord",
    "BulkDealRecord",
    "DeliveryRecord",
    "FlowRecord",
    "FlowsResponse",
    "FnOChainResponse",
    "MarketMeta",
    "MicrostructureResponse",
    "OHLCVBar",
    "OHLCVResponse",
    "StrikeData",
    "SymbolMeta",
]
