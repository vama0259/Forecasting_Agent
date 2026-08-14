from datetime import date, timedelta

from forecasting_agent.data_server.contracts import OHLCVBar


def _series(closes):
    base = date(2024, 1, 1)
    return [
        OHLCVBar(date=base + timedelta(days=i), open=c, high=c, low=c, close=c, volume=100)
        for i, c in enumerate(closes)
    ]


def test_clips_not_drops_an_injected_outlier():
    from forecasting_agent.data_server.cleaner import hampel_clip

    closes = [100.0] * 25 + [500.0] + [100.0] * 5
    bars = _series(closes)
    result = hampel_clip(bars, window=20, threshold=3.5)
    assert len(result) == len(bars)
    assert result[25].is_outlier is True
    assert result[25].close < 500.0
    assert result[0].close == 100.0


def test_no_outliers_leaves_series_unchanged():
    from forecasting_agent.data_server.cleaner import hampel_clip

    bars = _series([100.0] * 30)
    result = hampel_clip(bars, window=20, threshold=3.5)
    assert all(not b.is_outlier for b in result)
    assert [b.close for b in result] == [100.0] * 30


def test_flags_zero_volume_bar_as_circuit_locked():
    from forecasting_agent.data_server.cleaner import flag_circuit_locked

    bars = _series([100.0, 100.0, 100.0])
    bars[1] = bars[1].model_copy(update={"volume": 0})
    result = flag_circuit_locked(bars)
    assert result[0].is_circuit_locked is False
    assert result[1].is_circuit_locked is True
    assert result[2].is_circuit_locked is False


def test_normal_volume_bars_are_not_flagged():
    from forecasting_agent.data_server.cleaner import flag_circuit_locked

    bars = _series([100.0, 101.0, 99.0])
    result = flag_circuit_locked(bars)
    assert all(not b.is_circuit_locked for b in result)
