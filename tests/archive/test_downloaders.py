# Tests for archive downloaders: retry schedule, 404-as-gap, and fallback against mocked httpx.

from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from forecasting_agent.archive.downloaders.nse_bhavcopy import NseBhavcopyDownloader
from forecasting_agent.archive.downloaders.nse_participant_oi import NseParticipantOiDownloader
from forecasting_agent.archive.errors import SourceUnavailableError

FIXTURES = Path(__file__).parent / "fixtures"


def _response(status_code: int, content: bytes = b"") -> httpx.Response:
    return httpx.Response(status_code=status_code, content=content, request=httpx.Request("GET", "https://x"))


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_participant_oi_200_returns_bytes(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "participant_oi_sample.csv").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseParticipantOiDownloader().fetch_raw(date(2026, 8, 14))

    assert result == fixture_bytes
    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_participant_oi_404_raises_immediately_no_retry(mock_get: MagicMock):
    mock_get.return_value = _response(404)

    with pytest.raises(SourceUnavailableError):
        NseParticipantOiDownloader().fetch_raw(date(2026, 8, 15))

    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_transport_failure_retries_exactly_3_times_total_then_raises(mock_get: MagicMock):
    mock_get.side_effect = httpx.ConnectError("connection reset")

    with pytest.raises(httpx.ConnectError):
        NseParticipantOiDownloader().fetch_raw(date(2026, 8, 14))

    assert mock_get.call_count == 3


@patch("forecasting_agent.archive.downloaders.nse_bhavcopy.httpx.get")
def test_bhavcopy_udiff_404_falls_back_to_legacy_200(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "bhavcopy_cm_sample.csv").read_bytes()
    mock_get.side_effect = [_response(404), _response(200, fixture_bytes)]

    result = NseBhavcopyDownloader(segment="CM").fetch_raw(date(2015, 1, 5))

    assert result == fixture_bytes
    assert mock_get.call_count == 2
    first_url = mock_get.call_args_list[0].args[0]
    second_url = mock_get.call_args_list[1].args[0]
    assert "nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM" in first_url
    assert "nsearchives.nseindia.com/content/historical/EQUITIES" in second_url


@patch("forecasting_agent.archive.downloaders.nse_bhavcopy.httpx.get")
def test_bhavcopy_udiff_200_does_not_try_legacy(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "bhavcopy_cm_sample.csv").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseBhavcopyDownloader(segment="CM").fetch_raw(date(2026, 8, 14))

    assert result == fixture_bytes
    assert mock_get.call_count == 1
