# Tests for run_daily orchestration: downloader success/404/exception routed correctly to store.write and logged.

import logging
from datetime import date
from unittest.mock import MagicMock

from forecasting_agent.archive.errors import SourceUnavailableError
from forecasting_agent.archive.run_daily import run_all_downloaders


def test_successful_download_writes_ok_row():
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.return_value = b"bytes"

    run_all_downloaders(store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 14))

    mock_store.write.assert_called_once_with(source="test_source", observed_on=date(2026, 8, 14), content=b"bytes")


def test_source_unavailable_writes_gap_row_and_does_not_crash():
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.side_effect = SourceUnavailableError("404")

    run_all_downloaders(store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 15))

    mock_store.write.assert_called_once_with(
        source="test_source", observed_on=date(2026, 8, 15), content=None, detail="404"
    )


def test_gap_is_logged_at_error_level(caplog):
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.side_effect = SourceUnavailableError("404")

    with caplog.at_level(logging.ERROR):
        run_all_downloaders(
            store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 15)
        )

    assert any(r.levelno == logging.ERROR for r in caplog.records)


def test_one_downloader_failing_does_not_block_the_others():
    mock_store = MagicMock()
    failing = MagicMock()
    failing.fetch_raw.side_effect = SourceUnavailableError("404")
    succeeding = MagicMock()
    succeeding.fetch_raw.return_value = b"bytes"

    run_all_downloaders(
        store=mock_store,
        downloaders={"failing_source": failing, "succeeding_source": succeeding},
        observed_on=date(2026, 8, 14),
    )

    assert mock_store.write.call_count == 2
