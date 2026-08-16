# Unit tests for AngelOneInstrumentMaster.
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
