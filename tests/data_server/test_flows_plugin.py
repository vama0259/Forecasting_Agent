# Tests FlowsPlugin parses the real archived participant-OI fixture into typed FlowRecord rows.

from datetime import date
from pathlib import Path
from unittest.mock import patch

from forecasting_agent.data_server.plugins.flows import FlowsPlugin


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_parses_real_fixture_into_flow_records(mock_store_cls):
    fixture = (Path(__file__).parent.parent / "archive" / "fixtures" / "participant_oi_sample.csv").read_bytes()
    mock_store_cls.return_value.read.return_value = fixture

    records = FlowsPlugin().fetch(date(2026, 8, 14))

    assert len(records) == 5  # Client, DII, FII, Pro, TOTAL -- matches the real fixture's row count
    fii = next(r for r in records if r.participant == "FII")
    assert fii.total_long_contracts == 4358938  # exact value from the committed fixture


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_returns_empty_list_when_archive_has_no_data_for_the_date(mock_store_cls):
    mock_store_cls.return_value.read.return_value = None

    records = FlowsPlugin().fetch(date(2026, 1, 1))

    assert records == []
