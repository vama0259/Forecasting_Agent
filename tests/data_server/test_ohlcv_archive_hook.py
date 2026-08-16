# Tests that fetch_ohlcv archives bars only on a genuine fresh fetch, never on cache-hit or stale-fallback.

from datetime import date
from unittest.mock import patch

from forecasting_agent.data_server.contracts import OHLCVBar


def _bar(d: date) -> OHLCVBar:
    return OHLCVBar(
        date=d,
        open=100.0,
        high=105.0,
        low=99.0,
        close=103.0,
        volume=1000,
        is_outlier=False,
        is_circuit_locked=False,
    )


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_fresh_fetch_archives_the_bars(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = None
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = [_bar(date(2026, 8, 14))]
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_called_once()
    assert mock_store.write.call_args.kwargs["source"] == "ohlcv:NSE:RELIANCE.NS"


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_cache_hit_does_not_archive(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = [_bar(date(2026, 8, 14))]
    mock_cache.is_stale.return_value = False
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_not_called()


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_stale_fallback_does_not_archive(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = [_bar(date(2026, 8, 10))]
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = []  # plugin returned nothing -> stale-cache fallback path
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_not_called()


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_archive_write_failure_is_logged_not_raised(mock_cache_cls, mock_resolve, mock_store_cls, caplog):
    from forecasting_agent.archive.errors import ArchiveWriteError
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = None
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = [_bar(date(2026, 8, 14))]
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value
    mock_store.write.side_effect = ArchiveWriteError("db down")

    result = fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    assert result is not None  # fetch_ohlcv still returns normally
