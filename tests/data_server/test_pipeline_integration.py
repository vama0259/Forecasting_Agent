from datetime import date
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
