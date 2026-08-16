from datetime import date

import pytest
from pydantic import ValidationError

from forecasting_agent.data_server.contracts import MarketMeta, OHLCVBar, OHLCVResponse, SymbolMeta


def test_ohlcv_bar_accepts_valid_shape():
    bar = OHLCVBar(
        date=date(2024, 1, 1),
        open=100.0,
        high=105.0,
        low=99.0,
        close=103.0,
        volume=1000,
        is_outlier=False,
        is_circuit_locked=False,
    )
    assert bar.close == 103.0


def test_ohlcv_bar_rejects_negative_volume():
    with pytest.raises(ValidationError):
        OHLCVBar(date=date(2024, 1, 1), open=100.0, high=105.0, low=99.0, close=103.0, volume=-1)


def test_ohlcv_response_nests_bars():
    resp = OHLCVResponse(symbol="RELIANCE.NS", market="NSE", bars=[], data_stale=False)
    assert resp.bars == []


def test_symbol_meta_requires_market():
    with pytest.raises(ValidationError):
        SymbolMeta(symbol="RELIANCE.NS")


def test_market_meta_accepts_valid_shape():
    meta = MarketMeta(market="NSE", display_name="National Stock Exchange", timezone="Asia/Kolkata")
    assert meta.market == "NSE"


def test_flow_record_rejects_negative_contracts():
    from forecasting_agent.data_server.contracts import FlowRecord

    with pytest.raises(ValidationError):
        FlowRecord(
            observed_on=date(2026, 8, 14),
            participant="FII",
            future_index_long=-1,
            future_index_short=0,
            future_stock_long=0,
            future_stock_short=0,
            option_index_call_long=0,
            option_index_put_long=0,
            option_index_call_short=0,
            option_index_put_short=0,
            option_stock_call_long=0,
            option_stock_put_long=0,
            option_stock_call_short=0,
            option_stock_put_short=0,
            total_long_contracts=0,
            total_short_contracts=0,
        )


def test_delivery_record_rejects_percentage_over_100():
    from forecasting_agent.data_server.contracts import DeliveryRecord

    with pytest.raises(ValidationError):
        DeliveryRecord(
            observed_on=date(2026, 8, 14),
            symbol="RELIANCE",
            series="EQ",
            quantity_traded=100,
            deliverable_quantity=50,
            delivery_pct=150.0,
        )


def test_bulk_deal_record_requires_positive_price():
    from forecasting_agent.data_server.contracts import BulkDealRecord

    with pytest.raises(ValidationError):
        BulkDealRecord(
            observed_on=date(2026, 8, 14),
            symbol="RELIANCE",
            client_name="X",
            buy_sell="BUY",
            quantity=100,
            price=0.0,
        )


def test_microstructure_response_defaults_to_empty_lists_and_no_coverage_note():
    from forecasting_agent.data_server.contracts import MicrostructureResponse

    resp = MicrostructureResponse(observed_on=date(2026, 8, 14))
    assert resp.delivery == []
    assert resp.bulk_deals == []
    assert resp.block_deals == []
    assert resp.coverage_note is None
