import time
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest


@pytest.fixture(autouse=True)
def _clean_shared_cache_files():
    # These tests exercise fetch_ohlcv(), which constructs ParquetCache() with the real,
    # shared data/cache/ohlcv/ directory (not injectable today) -- clean up whatever this
    # test run writes there so it can never leak into or be polluted by another run/session
    # (this exact class of staleness is what #36 was found through).
    cache_dir = Path("data/cache/ohlcv")
    before = set(cache_dir.glob("*.parquet")) if cache_dir.exists() else set()
    yield
    after = set(cache_dir.glob("*.parquet")) if cache_dir.exists() else set()
    for f in after - before:
        f.unlink(missing_ok=True)


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_full_pipeline_returns_validated_response(mock_download):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_download.return_value = pd.DataFrame(
        {"Open": [100.0], "High": [105.0], "Low": [99.0], "Close": [103.0], "Volume": [1000]},
        index=pd.to_datetime([date(2024, 1, 1)]),
    )
    result = fetch_ohlcv("RELIANCE.NS", "NSE", "2024-01-01", "2024-01-01", as_of=None)
    assert result.symbol == "RELIANCE.NS"
    assert len(result.bars) == 1


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_cached_data_for_one_period_is_not_served_for_an_unrelated_period(mock_download):
    # Regression test for #36: a cache entry for a recent window must never be served for a
    # request asking about a completely different, older period -- reproduced live before this
    # fix (a fresh-real-data cache entry for Aug 2026 was returned for a Jan 2024 request).
    from forecasting_agent.data_server.server import fetch_ohlcv

    today = date.today()  # noqa: DTZ011
    mock_download.return_value = pd.DataFrame(
        {"Open": [100.0], "High": [105.0], "Low": [99.0], "Close": [103.0], "Volume": [1000]},
        index=pd.to_datetime([today]),
    )
    # Populate the cache with a recent (today-only) entry.
    fetch_ohlcv("PERIODTEST.NS", "NSE", today.isoformat(), today.isoformat(), as_of=None)

    # A request for an unrelated old date must NOT be served from that cache entry --
    # it must genuinely re-fetch (via the mock, which now returns the old date instead).
    mock_download.return_value = pd.DataFrame(
        {"Open": [50.0], "High": [55.0], "Low": [49.0], "Close": [53.0], "Volume": [500]},
        index=pd.to_datetime([date(2024, 1, 1)]),
    )
    result = fetch_ohlcv("PERIODTEST.NS", "NSE", "2024-01-01", "2024-01-01", as_of=None)

    assert len(result.bars) == 1
    assert result.bars[0].date == date(2024, 1, 1)
    assert result.bars[0].close == 53.0


def test_future_as_of_raises_leakage_error_through_the_full_tool():
    import pytest

    from forecasting_agent.data_server.point_in_time import LeakageError
    from forecasting_agent.data_server.server import fetch_ohlcv

    future_year = date.today().year + 1  # noqa: DTZ011
    with pytest.raises(LeakageError):
        fetch_ohlcv(
            "RELIANCE.NS",
            "NSE",
            "2024-01-01",
            "2024-01-01",
            as_of=f"{future_year}-01-01",
        )


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_cache_hit_returns_under_50ms(mock_download):
    """Acceptance criterion: cache hit returns data in <50ms (issue #5 AC 4)."""
    from forecasting_agent.data_server.server import fetch_ohlcv

    today = date.today()  # noqa: DTZ011
    start = today - timedelta(days=5)
    # One bar per day across the full requested range -- a single bar dated "today" regardless
    # of the requested start/end (the previous shape here) doesn't actually cover [start, today],
    # which #36's fix now checks for before treating this as a cache hit.
    date_range = pd.date_range(start=start, end=today, freq="D")
    n = len(date_range)
    mock_download.return_value = pd.DataFrame(
        {
            "Open": [100.0] * n,
            "High": [105.0] * n,
            "Low": [99.0] * n,
            "Close": [103.0] * n,
            "Volume": [1000] * n,
        },
        index=date_range,
    )
    # Populate the cache — this call is allowed to hit the (mocked) plugin.
    fetch_ohlcv("LATENCYTEST.NS", "NSE", start.isoformat(), today.isoformat(), as_of=None)

    # Cache hit: must not call the plugin, and the steady-state hot path must be fast.
    # The first hit after a fresh process pays one-time pandas/pyarrow init costs, so we
    # discount a single warm-up call rather than asserting on it directly.
    with patch(
        "forecasting_agent.data_server.plugins.nse.yf.download",
        side_effect=AssertionError("cache hit must not call the plugin"),
    ):
        fetch_ohlcv("LATENCYTEST.NS", "NSE", start.isoformat(), today.isoformat(), as_of=None)
        t0 = time.perf_counter()
        result = fetch_ohlcv("LATENCYTEST.NS", "NSE", start.isoformat(), today.isoformat(), as_of=None)
        elapsed_ms = (time.perf_counter() - t0) * 1000

    assert result.data_stale is False
    assert elapsed_ms < 50, f"cache-hit latency {elapsed_ms:.2f}ms exceeds the 50ms acceptance criterion"
