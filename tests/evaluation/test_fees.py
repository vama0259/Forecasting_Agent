"""Tests for the Indian cost schedule — per-segment rates, buy/sell asymmetry, DP flat charge, GST base."""

from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.fees import (
    DP_CHARGE_INR,
    GST_RATE,
    INDIAN_RATE_VINTAGES,
    FeeProfile,
    IndianFeeSchedule,
    RateVintage,
)

TRADE_DATE = datetime(2026, 8, 14, tzinfo=UTC)
LEG = 10_000.0

EXPECTED = {
    ("EQUITY_DELIVERY", "buy"): 11.87406,
    ("EQUITY_DELIVERY", "sell"): 25.71406,
    ("EQUITY_INTRADAY", "buy"): 0.67406,
    ("EQUITY_INTRADAY", "sell"): 2.87406,
    ("EQUITY_FUTURES", "buy"): 0.42774,
    ("EQUITY_FUTURES", "sell"): 5.22774,
    ("EQUITY_OPTIONS", "buy"): 4.50434,
    ("EQUITY_OPTIONS", "sell"): 19.20434,
}


@pytest.fixture
def schedule() -> IndianFeeSchedule:
    """Takes nothing; returns the shipped zero-brokerage Indian fee schedule."""
    return IndianFeeSchedule()


@pytest.mark.parametrize(("key", "expected"), sorted(EXPECTED.items()))
def test_each_segment_and_side_matches_its_pinned_total(
    schedule: IndianFeeSchedule, key: tuple[str, str], expected: float
) -> None:
    segment, side = key
    assert schedule.total_fee(LEG, side, segment, TRADE_DATE) == pytest.approx(expected, abs=1e-9)  # type: ignore[arg-type]


def test_hold_period_is_free_regardless_of_notional(schedule: IndianFeeSchedule) -> None:
    assert schedule.total_fee(1_000_000.0, "hold", "EQUITY_DELIVERY", TRADE_DATE) == 0.0
    assert schedule.total_fee(0.0, "hold", "EQUITY_DELIVERY", TRADE_DATE) == 0.0


def test_dp_charge_applies_only_to_delivery_sells(schedule: IndianFeeSchedule) -> None:
    delivery_sell = schedule.total_fee(LEG, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    delivery_buy = schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE)
    intraday_sell = schedule.total_fee(LEG, "sell", "EQUITY_INTRADAY", TRADE_DATE)
    assert delivery_sell - DP_CHARGE_INR == pytest.approx(10.37406, abs=1e-9)
    assert delivery_buy < DP_CHARGE_INR
    assert intraday_sell < DP_CHARGE_INR


def test_dp_charge_is_excluded_from_the_gst_base(schedule: IndianFeeSchedule) -> None:
    delivery_sell = schedule.total_fee(LEG, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    if_dp_were_taxed = delivery_sell + GST_RATE * DP_CHARGE_INR
    assert delivery_sell == pytest.approx(25.71406, abs=1e-9)
    assert if_dp_were_taxed == pytest.approx(28.47526, abs=1e-9)
    assert delivery_sell != pytest.approx(if_dp_were_taxed, abs=1e-6)


def test_gst_is_charged_on_brokerage_plus_sebi_plus_exchange_only() -> None:
    zero = IndianFeeSchedule(brokerage=0.0)
    paid = IndianFeeSchedule(brokerage=20.0)
    assert paid.total_fee(LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE) - zero.total_fee(
        LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE
    ) == pytest.approx(20.0 * (1.0 + GST_RATE), abs=1e-9)


def test_dp_flat_charge_dominates_at_small_notional(schedule: IndianFeeSchedule) -> None:
    small = schedule.total_fee(1_000.0, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    large = schedule.total_fee(1_000_000.0, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    assert small / 1_000.0 > 0.015
    assert large / 1_000_000.0 < 0.0015
    assert small / 1_000.0 > large / 1_000_000.0


def test_rate_vintage_is_selected_by_trade_date_not_by_now() -> None:
    old_profile = FeeProfile(stt_buy=0.0, stt_sell=0.0, exchange_txn=0.0, stamp_duty=0.0, dp_applies=False)
    new_profile = FeeProfile(stt_buy=0.5, stt_sell=0.5, exchange_txn=0.0, stamp_duty=0.0, dp_applies=False)
    profiles_old = dict.fromkeys(
        ("EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS"), old_profile
    )
    profiles_new = dict.fromkeys(
        ("EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS"), new_profile
    )
    schedule = IndianFeeSchedule(
        brokerage=0.0,
        vintages=(
            RateVintage(effective_from=datetime(2020, 1, 1, tzinfo=UTC), profiles=profiles_old),  # type: ignore[arg-type]
            RateVintage(effective_from=datetime(2025, 1, 1, tzinfo=UTC), profiles=profiles_new),  # type: ignore[arg-type]
        ),
    )
    fee_old = schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(2023, 6, 1, tzinfo=UTC))
    assert fee_old == pytest.approx(0.0118, abs=1e-9)
    fee_new = schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(2026, 6, 1, tzinfo=UTC))
    assert fee_new == pytest.approx(5000.0118, abs=1e-9)


def test_trade_date_before_the_earliest_vintage_raises(schedule: IndianFeeSchedule) -> None:
    with pytest.raises(ValueError, match="1999"):
        schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(1999, 1, 1, tzinfo=UTC))


def test_shipped_schedule_has_exactly_one_vintage_effective_2024() -> None:
    assert len(INDIAN_RATE_VINTAGES) == 1
    assert INDIAN_RATE_VINTAGES[0].effective_from == datetime(2024, 1, 1, tzinfo=UTC)
    assert set(INDIAN_RATE_VINTAGES[0].profiles) == {
        "EQUITY_DELIVERY",
        "EQUITY_INTRADAY",
        "EQUITY_FUTURES",
        "EQUITY_OPTIONS",
    }


def test_profiles_are_frozen(schedule: IndianFeeSchedule) -> None:
    profile = INDIAN_RATE_VINTAGES[0].profiles["EQUITY_DELIVERY"]
    with pytest.raises(Exception, match=r"cannot assign|rozen"):
        setattr(profile, "stt_buy", 0.9)  # noqa: B010


@given(
    notional=st.floats(1e3, 1e8, allow_nan=False, allow_infinity=False),
    multiplier=st.floats(10.0, 1e3, allow_nan=False, allow_infinity=False),
)
def test_delivery_sell_cost_fraction_strictly_decreases_in_notional(notional: float, multiplier: float) -> None:
    schedule = IndianFeeSchedule()
    larger = notional * multiplier
    assume_bounded = 1e3 <= notional <= 1e9 and 1e3 <= larger <= 1e9
    if not assume_bounded:
        return
    small_fraction = schedule.total_fee(notional, "sell", "EQUITY_DELIVERY", TRADE_DATE) / notional
    large_fraction = schedule.total_fee(larger, "sell", "EQUITY_DELIVERY", TRADE_DATE) / larger
    assert small_fraction > large_fraction
