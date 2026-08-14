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
