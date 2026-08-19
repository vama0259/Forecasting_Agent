# Unit tests for AngelOneInstrumentMaster.
from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


def _fake_response(rows: list[dict[str, Any]]) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = rows
    resp.raise_for_status.return_value = None
    return resp


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_resolve_hit_returns_token(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [{"token": "58072", "symbol": "NIFTY25AUG26FUT", "exch_seg": "NFO", "name": "NIFTY"}]
    )
    master = AngelOneInstrumentMaster()
    assert master.resolve("NIFTY25AUG26FUT", "NFO") == "58072"


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_resolve_miss_raises_symbol_not_found(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import (
        AngelOneInstrumentMaster,
        SymbolNotFoundError,
    )

    mock_get.return_value = _fake_response([{"token": "1", "symbol": "OTHER", "exch_seg": "NFO", "name": "X"}])
    master = AngelOneInstrumentMaster()
    with pytest.raises(SymbolNotFoundError):
        master.resolve("NIFTY25AUG26FUT", "NFO")


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_second_resolve_call_does_not_refetch(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [{"token": "58072", "symbol": "NIFTY25AUG26FUT", "exch_seg": "NFO", "name": "NIFTY"}]
    )
    master = AngelOneInstrumentMaster()
    master.resolve("NIFTY25AUG26FUT", "NFO")
    master.resolve("NIFTY25AUG26FUT", "NFO")
    assert mock_get.call_count == 1


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_get_called_with_explicit_timeout(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster, SymbolNotFoundError

    mock_get.return_value = _fake_response([])
    with pytest.raises(SymbolNotFoundError):
        AngelOneInstrumentMaster().resolve("X", "NFO")
    assert mock_get.call_args.kwargs.get("timeout") == 30


def _option_row(symbol: str, expiry: str, strike_x100: str, token: str = "1") -> dict[str, Any]:  # noqa: S107
    # token is an Angel One instrument token identifier, not a credential.
    return {
        "token": token,
        "symbol": symbol,
        "name": "TCS",
        "exch_seg": "NFO",
        "instrumenttype": "OPTSTK",
        "expiry": expiry,
        "strike": strike_x100,
    }


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_list_option_chain_returns_all_contracts_for_an_explicit_expiry(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [
            _option_row("TCS29SEP262020CE", "29SEP2026", "202000.000000", "1"),
            _option_row("TCS29SEP262020PE", "29SEP2026", "202000.000000", "2"),
            _option_row("TCS27OCT262020CE", "27OCT2026", "202000.000000", "3"),
            {
                "token": "9",
                "symbol": "RELIANCE29SEP262500CE",
                "name": "RELIANCE",
                "exch_seg": "NFO",
                "instrumenttype": "OPTSTK",
                "expiry": "29SEP2026",
                "strike": "250000.000000",
            },
        ]
    )
    master = AngelOneInstrumentMaster()
    rows = master.list_option_chain("TCS", expiry="29SEP2026")

    assert {r["token"] for r in rows} == {"1", "2"}


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_list_option_chain_picks_nearest_expiry_on_or_after_as_of_when_expiry_omitted(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [
            _option_row("TCS27AUG262020CE", "27AUG2026", "202000.000000", "1"),
            _option_row("TCS29SEP262020CE", "29SEP2026", "202000.000000", "2"),
            _option_row("TCS27OCT262020CE", "27OCT2026", "202000.000000", "3"),
        ]
    )
    master = AngelOneInstrumentMaster()
    rows = master.list_option_chain("TCS", as_of=date(2026, 9, 1))

    assert {r["token"] for r in rows} == {"2"}


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_list_option_chain_returns_empty_when_no_expiry_on_or_after_as_of(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response([_option_row("TCS27AUG262020CE", "27AUG2026", "202000.000000", "1")])
    master = AngelOneInstrumentMaster()
    rows = master.list_option_chain("TCS", as_of=date(2026, 12, 1))

    assert rows == []


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_list_option_chain_returns_empty_for_unknown_underlying(mock_get: MagicMock) -> None:
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response([_option_row("TCS29SEP262020CE", "29SEP2026", "202000.000000", "1")])
    master = AngelOneInstrumentMaster()
    rows = master.list_option_chain("NOTREAL")

    assert rows == []
