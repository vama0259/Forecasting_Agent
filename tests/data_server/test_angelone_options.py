# Unit tests for AngelOneOptionChainPlugin.
from datetime import date
from unittest.mock import MagicMock

import pytest

from forecasting_agent.data_server.plugins.angelone_options import AngelOneApiError, AngelOneOptionChainPlugin


def _contract(token: str, symbol: str, strike_x100: str, expiry: str = "29SEP2026") -> dict:
    return {
        "token": token,
        "symbol": symbol,
        "name": "TCS",
        "expiry": expiry,
        "strike": strike_x100,
        "instrumenttype": "OPTSTK",
        "exch_seg": "NFO",
    }


def _quote_row(token: str, ltp: float, oi: int) -> dict:
    return {"symbolToken": token, "ltp": ltp, "opnInterest": oi}


def test_fetch_chain_merges_call_and_put_quotes_by_strike() -> None:
    mock_instruments = MagicMock()
    mock_instruments.list_option_chain.return_value = [
        _contract("1", "TCS29SEP262020CE", "202000.000000"),
        _contract("2", "TCS29SEP262020PE", "202000.000000"),
    ]
    mock_session = MagicMock()
    mock_session.get_valid_token.return_value = "jwt1"
    mock_client = MagicMock()
    mock_session.client = mock_client
    mock_client.getMarketData.return_value = {
        "status": True,
        "data": {"fetched": [_quote_row("1", 45.5, 12000), _quote_row("2", 30.2, 8000)]},
    }

    plugin = AngelOneOptionChainPlugin(instruments=mock_instruments, session=mock_session)
    resolved_expiry, strikes = plugin.fetch_chain("TCS")

    assert resolved_expiry == date(2026, 9, 29)
    assert len(strikes) == 1
    assert strikes[0].strike_price == 2020.0
    assert strikes[0].call_ltp == 45.5
    assert strikes[0].call_oi == 12000
    assert strikes[0].put_ltp == 30.2
    assert strikes[0].put_oi == 8000
    mock_client.setAccessToken.assert_called_once_with("jwt1")


def test_fetch_chain_raises_when_no_contracts_found() -> None:
    mock_instruments = MagicMock()
    mock_instruments.list_option_chain.return_value = []
    mock_session = MagicMock()

    plugin = AngelOneOptionChainPlugin(instruments=mock_instruments, session=mock_session)
    with pytest.raises(AngelOneApiError, match="No NFO option contracts found for 'TCS'"):
        plugin.fetch_chain("TCS")


def test_fetch_chain_raises_on_explicit_api_error_instead_of_silently_returning_empty() -> None:
    mock_instruments = MagicMock()
    mock_instruments.list_option_chain.return_value = [_contract("1", "TCS29SEP262020CE", "202000.000000")]
    mock_session = MagicMock()
    mock_session.get_valid_token.return_value = "jwt1"
    mock_client = MagicMock()
    mock_session.client = mock_client
    mock_client.getMarketData.return_value = {"status": False, "message": "Invalid Token"}

    plugin = AngelOneOptionChainPlugin(instruments=mock_instruments, session=mock_session)
    with pytest.raises(AngelOneApiError, match="Invalid Token"):
        plugin.fetch_chain("TCS")


def test_fetch_chain_batches_quote_requests_past_50_tokens() -> None:
    mock_instruments = MagicMock()
    contracts = [_contract(str(i), f"TCS29SEP26{2000 + i}CE", f"{(2000 + i) * 100}.000000") for i in range(60)]
    mock_instruments.list_option_chain.return_value = contracts
    mock_session = MagicMock()
    mock_session.get_valid_token.return_value = "jwt1"
    mock_client = MagicMock()
    mock_session.client = mock_client
    mock_client.getMarketData.return_value = {"status": True, "data": {"fetched": []}}

    plugin = AngelOneOptionChainPlugin(instruments=mock_instruments, session=mock_session)
    plugin.fetch_chain("TCS")

    assert mock_client.getMarketData.call_count == 2


def test_fetch_chain_ignores_quote_rows_for_unknown_or_non_option_symbols() -> None:
    mock_instruments = MagicMock()
    mock_instruments.list_option_chain.return_value = [_contract("1", "TCS29SEP262020CE", "202000.000000")]
    mock_session = MagicMock()
    mock_session.get_valid_token.return_value = "jwt1"
    mock_client = MagicMock()
    mock_session.client = mock_client
    mock_client.getMarketData.return_value = {
        "status": True,
        "data": {"fetched": [_quote_row("999", 1.0, 1), _quote_row("1", 45.5, 12000)]},
    }

    plugin = AngelOneOptionChainPlugin(instruments=mock_instruments, session=mock_session)
    _, strikes = plugin.fetch_chain("TCS")

    assert len(strikes) == 1
    assert strikes[0].call_ltp == 45.5
