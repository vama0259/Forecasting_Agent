from datetime import date
from unittest.mock import patch

import pandas as pd


def test_supports_ns_and_bo_suffixes():
    from forecasting_agent.data_server.plugins.nse import NsePlugin

    plugin = NsePlugin()
    assert plugin.supports("RELIANCE.NS")
    assert plugin.supports("RELIANCE.BO")
    assert not plugin.supports("AAPL")


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_fetch_maps_yfinance_response_to_ohlcv_bar(mock_download):
    from forecasting_agent.data_server.plugins.nse import NsePlugin

    mock_download.return_value = pd.DataFrame(
        {"Open": [100.0], "High": [105.0], "Low": [99.0], "Close": [103.0], "Volume": [1000]},
        index=pd.to_datetime([date(2024, 1, 1)]),
    )
    plugin = NsePlugin()
    bars = plugin.fetch("RELIANCE.NS", date(2024, 1, 1), date(2024, 1, 1))
    assert len(bars) == 1
    assert bars[0].close == 103.0
    assert bars[0].volume == 1000
