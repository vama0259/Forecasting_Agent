# Unit tests for AngelOnePlugin.
from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch


def _candle_response(rows: list[list[Any]]) -> dict[str, Any]:
    # SmartAPI getCandleData shape: {"status": True, "data": [[ts, o, h, l, c, v], ...]}
    return {"status": True, "data": rows}


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_supports_nfo_bfo_cds_mcx_suffix_patterns(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    assert plugin.supports("NIFTY25AUG26FUT")
    assert plugin.supports("SENSEX27MAR74000PE")
    assert plugin.supports("SENSEX26SEP85000CE")
    assert not plugin.supports("RELIANCE.NS")


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_fetch_maps_candle_rows_to_ohlcv_bars(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments_cls.return_value.resolve.return_value = "58072"
    mock_client.getCandleData.return_value = _candle_response(
        [["2026-08-01T00:00:00+05:30", 100.0, 105.0, 99.0, 103.0, 1000]]
    )

    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    bars = plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))

    assert len(bars) == 1
    assert bars[0].close == 103.0
    assert bars[0].volume == 1000


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_fetch_returns_empty_list_on_empty_candle_response(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments_cls.return_value.resolve.return_value = "58072"
    mock_client.getCandleData.return_value = _candle_response([])

    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    bars = plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))

    assert bars == []


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_fetch_raises_on_explicit_api_error_instead_of_silently_returning_empty(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    import pytest

    from forecasting_agent.data_server.plugins.angelone import AngelOneApiError, AngelOnePlugin

    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments_cls.return_value.resolve.return_value = "58072"
    mock_client.getCandleData.return_value = {
        "success": False,
        "message": "Invalid Token",
        "errorCode": "AG8001",
        "data": "",
    }

    plugin = AngelOnePlugin()
    with pytest.raises(AngelOneApiError, match="Invalid Token"):
        plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))


def test_no_order_management_methods_referenced_in_module() -> None:
    import inspect

    from forecasting_agent.data_server.plugins import angelone

    source = inspect.getsource(angelone)
    forbidden = ["placeOrder", "modifyOrder", "cancelOrder", "getOrderBook", "getPosition"]
    for name in forbidden:
        assert name not in source, f"{name} must never appear in angelone.py (spec Design Decision 5)"
