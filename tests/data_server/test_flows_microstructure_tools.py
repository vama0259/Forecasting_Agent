# Tests fetch_flows/fetch_microstructure MCP tools resolve via ConnectorRegistry and apply as_of filtering.

from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from forecasting_agent.data_server.contracts import FlowRecord, MicrostructureResponse
from forecasting_agent.data_server.point_in_time import LeakageError
from forecasting_agent.data_server.server import fetch_flows, fetch_microstructure


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_flows_applies_as_of_filtering(mock_get_registry):
    record = FlowRecord(
        observed_on=date(2026, 8, 10),
        participant="FII",
        future_index_long=1,
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
        total_long_contracts=1,
        total_short_contracts=0,
    )
    mock_connector = MagicMock()
    mock_connector.fetch.return_value = [record]
    mock_get_registry.return_value.resolve.return_value = mock_connector

    result = fetch_flows(observed_on="2026-08-10", as_of="2026-08-10")

    assert len(result.records) == 1
    mock_get_registry.return_value.resolve.assert_called_once_with("flows")


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_flows_leakage_error_propagates_for_future_as_of(mock_get_registry):
    mock_get_registry.return_value.resolve.return_value.fetch.return_value = []

    with pytest.raises(LeakageError):
        fetch_flows(observed_on="2026-08-10", as_of="2099-01-01")


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_microstructure_calls_the_microstructure_connector(mock_get_registry):
    mock_get_registry.return_value.resolve.return_value.fetch.return_value = MicrostructureResponse(
        observed_on=date(2026, 8, 10)
    )

    fetch_microstructure(observed_on="2026-08-10")

    mock_get_registry.return_value.resolve.assert_called_once_with("microstructure")
