"""Indian transaction fee schedule verified against broker charges page (https://zerodha.com/charges/) on 2026-08-14."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

Segment = Literal["EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS"]
TradeSide = Literal["buy", "sell", "hold"]

DP_CHARGE_INR: float = 15.34
GST_RATE: float = 0.18
SEBI_TURNOVER_RATE: float = 1e-6


@dataclass(frozen=True)
class FeeProfile:
    """Frozen container for statutory and exchange fee rates for a specific asset segment."""

    stt_buy: float
    stt_sell: float
    exchange_txn: float
    stamp_duty: float
    dp_applies: bool


@dataclass(frozen=True)
class RateVintage:
    """Frozen container mapping effective start datetime to segment fee profiles."""

    effective_from: datetime
    profiles: Mapping[Segment, FeeProfile]


INDIAN_RATE_VINTAGES: tuple[RateVintage, ...] = (
    RateVintage(
        effective_from=datetime(2024, 1, 1, tzinfo=UTC),
        profiles={
            "EQUITY_DELIVERY": FeeProfile(
                stt_buy=0.001,
                stt_sell=0.001,
                exchange_txn=0.0000307,
                stamp_duty=0.00015,
                dp_applies=True,
            ),
            "EQUITY_INTRADAY": FeeProfile(
                stt_buy=0.0,
                stt_sell=0.00025,
                exchange_txn=0.0000307,
                stamp_duty=0.00003,
                dp_applies=False,
            ),
            "EQUITY_FUTURES": FeeProfile(
                stt_buy=0.0,
                stt_sell=0.0005,
                exchange_txn=0.0000183,
                stamp_duty=0.00002,
                dp_applies=False,
            ),
            "EQUITY_OPTIONS": FeeProfile(
                stt_buy=0.0,
                stt_sell=0.0015,
                exchange_txn=0.0003553,
                stamp_duty=0.00003,
                dp_applies=False,
            ),
        },
    ),
)


@dataclass(frozen=True)
class IndianFeeSchedule:
    """Frozen fee schedule computing total statutory, exchange, and brokerage transaction costs."""

    brokerage: float = 0.0
    vintages: tuple[RateVintage, ...] = INDIAN_RATE_VINTAGES

    def total_fee(
        self,
        position_notional: float,
        trade_side: TradeSide,
        segment: Segment,
        trade_date: datetime,
    ) -> float:
        """Takes notional, trade side, segment, and trade date; returns total transaction cost in INR."""
        if trade_side == "hold":
            return 0.0

        matching = [v for v in self.vintages if v.effective_from <= trade_date]
        if not matching:
            raise ValueError(f"No fee rate vintage found effective for trade date {trade_date}")

        vintage = max(matching, key=lambda v: v.effective_from)
        profile = vintage.profiles[segment]

        stt = position_notional * (profile.stt_buy if trade_side == "buy" else profile.stt_sell)
        exchange = position_notional * profile.exchange_txn
        sebi = position_notional * SEBI_TURNOVER_RATE
        stamp = position_notional * profile.stamp_duty if trade_side == "buy" else 0.0
        gst = GST_RATE * (self.brokerage + sebi + exchange)
        dp = DP_CHARGE_INR if (profile.dp_applies and trade_side == "sell") else 0.0

        return self.brokerage + stt + exchange + sebi + stamp + gst + dp
