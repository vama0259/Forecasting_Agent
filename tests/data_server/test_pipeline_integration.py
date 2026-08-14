import time
from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd


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
    mock_download.return_value = pd.DataFrame(
        {"Open": [100.0], "High": [105.0], "Low": [99.0], "Close": [103.0], "Volume": [1000]},
        index=pd.to_datetime([today]),
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
