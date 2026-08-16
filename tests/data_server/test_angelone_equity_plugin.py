# Unit tests for AngelOneEquityPlugin.
from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


def _candle_response(rows: list[list[Any]]) -> dict[str, Any]:
    return {"status": True, "data": rows}


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_supports_ns_and_bo_suffixes(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin

    plugin = AngelOneEquityPlugin()
    assert plugin.supports("RELIANCE.NS")
    assert plugin.supports("RELIANCE.BO")
    assert not plugin.supports("NIFTY25AUG26FUT")


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_fetch_translates_ns_symbol_to_eq_suffix_on_nse(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments = mock_instruments_cls.return_value
    mock_instruments.resolve.return_value = "3045"
    mock_client.getCandleData.return_value = _candle_response(
        [["2026-08-01T00:00:00+05:30", 100.0, 105.0, 99.0, 103.0, 1000]]
    )

    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin

    plugin = AngelOneEquityPlugin()
    bars = plugin.fetch("SBIN.NS", date(2026, 8, 1), date(2026, 8, 1))

    mock_instruments.resolve.assert_called_once_with("SBIN-EQ", "NSE")
    assert len(bars) == 1
    assert bars[0].close == 103.0


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_fetch_translates_bo_symbol_with_no_suffix_on_bse(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    # Verified live: BSE equity symbols have NO "-EQ" suffix, unlike NSE -- real bug if assumed otherwise.
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments = mock_instruments_cls.return_value
    mock_instruments.resolve.return_value = "500325"
    mock_client.getCandleData.return_value = _candle_response(
        [["2026-08-01T00:00:00+05:30", 100.0, 105.0, 99.0, 103.0, 1000]]
    )

    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin

    plugin = AngelOneEquityPlugin()
    bars = plugin.fetch("RELIANCE.BO", date(2026, 8, 1), date(2026, 8, 1))

    mock_instruments.resolve.assert_called_once_with("RELIANCE", "BSE")
    assert len(bars) == 1


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_fetch_rejects_symbol_without_ns_or_bo_suffix(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin, SymbolNotFoundError

    plugin = AngelOneEquityPlugin()
    with pytest.raises(SymbolNotFoundError):
        plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_fetch_returns_empty_list_on_empty_candle_response(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments_cls.return_value.resolve.return_value = "3045"
    mock_client.getCandleData.return_value = _candle_response([])

    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin

    plugin = AngelOneEquityPlugin()
    bars = plugin.fetch("SBIN.NS", date(2026, 8, 1), date(2026, 8, 1))

    assert bars == []


@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone_equity.AngelOneSession")
def test_fetch_raises_on_explicit_api_error(
    mock_session_cls: MagicMock, mock_instruments_cls: MagicMock, mock_from_env: MagicMock
) -> None:
    mock_client = MagicMock()
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_session_cls.return_value.client = mock_client
    mock_instruments_cls.return_value.resolve.return_value = "3045"
    mock_client.getCandleData.return_value = {"success": False, "message": "Invalid Token", "data": ""}

    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneApiError, AngelOneEquityPlugin

    plugin = AngelOneEquityPlugin()
    with pytest.raises(AngelOneApiError, match="Invalid Token"):
        plugin.fetch("SBIN.NS", date(2026, 8, 1), date(2026, 8, 1))


def test_construction_never_raises_when_env_vars_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # PluginRegistry eagerly constructs every plugin at startup -- a hard failure here would
    # crash NSE/BSE resolution entirely in any environment without Angel One credentials set.
    for var in ("ANGELONE_API_KEY", "ANGELONE_CLIENT_CODE", "ANGELONE_MPIN", "ANGELONE_TOTP_SECRET"):
        monkeypatch.delenv(var, raising=False)

    from forecasting_agent.data_server.plugins.angelone_equity import AngelOneEquityPlugin

    AngelOneEquityPlugin()  # must not raise
