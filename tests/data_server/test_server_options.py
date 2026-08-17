from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from forecasting_agent.data_server.point_in_time import LeakageError
from forecasting_agent.data_server.server import fetch_option_chain


def test_fetch_option_chain_defaults_to_nearest_expiry() -> None:
    with patch("forecasting_agent.data_server.server.yf.Ticker") as mock_ticker:
        instance = MagicMock()
        instance.options = ["2026-08-27", "2026-09-24"]
        mock_chain = MagicMock()
        mock_chain.calls = None
        mock_chain.puts = None
        instance.option_chain.return_value = mock_chain
        mock_ticker.return_value = instance

        res = fetch_option_chain(underlying="TCS.NS")
        assert res.expiry == date(2026, 8, 27)
        assert res.strikes == []


def test_fetch_option_chain_explicit_expiry() -> None:
    with patch("forecasting_agent.data_server.server.yf.Ticker") as mock_ticker:
        instance = MagicMock()
        instance.options = ["2026-08-27", "2026-09-24"]
        mock_chain = MagicMock()
        mock_chain.calls = None
        mock_chain.puts = None
        instance.option_chain.return_value = mock_chain
        mock_ticker.return_value = instance

        res = fetch_option_chain(underlying="TCS.NS", expiry="2026-09-24")
        assert res.expiry == date(2026, 9, 24)
        instance.option_chain.assert_called_once_with("2026-09-24")


def test_fetch_option_chain_fallback_when_options_empty() -> None:
    with patch("forecasting_agent.data_server.server.yf.Ticker") as mock_ticker:
        instance = MagicMock()
        instance.options = []
        mock_chain = MagicMock()
        mock_chain.calls = None
        mock_chain.puts = None
        instance.option_chain.return_value = mock_chain
        mock_ticker.return_value = instance

        res = fetch_option_chain(underlying="INFY.NS", as_of="2026-08-10")
        assert res.expiry == date(2026, 8, 10)
        assert res.strikes == []


def test_fetch_option_chain_future_as_of_raises_leakage_error() -> None:
    with pytest.raises(LeakageError):
        fetch_option_chain(underlying="TCS.NS", as_of="2099-01-01")
