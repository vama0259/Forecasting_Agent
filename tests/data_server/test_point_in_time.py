from datetime import date, timedelta

import pytest

from forecasting_agent.data_server.contracts import OHLCVBar


def _bar(d):
    return OHLCVBar(date=d, open=1, high=1, low=1, close=1, volume=1)


def test_future_as_of_raises_leakage_error():
    from forecasting_agent.data_server.point_in_time import LeakageError, filter_as_of

    with pytest.raises(LeakageError):
        filter_as_of([_bar(date.today())], as_of=date.today() + timedelta(days=1))  # noqa: DTZ011


def test_past_as_of_excludes_later_bars():
    from forecasting_agent.data_server.point_in_time import filter_as_of

    bars = [_bar(date(2024, 1, 1)), _bar(date(2024, 1, 5)), _bar(date(2024, 1, 10))]
    result = filter_as_of(bars, as_of=date(2024, 1, 5))
    assert [b.date for b in result] == [date(2024, 1, 1), date(2024, 1, 5)]


def test_no_as_of_returns_everything():
    from forecasting_agent.data_server.point_in_time import filter_as_of

    bars = [_bar(date(2024, 1, 1)), _bar(date(2024, 1, 5))]
    assert filter_as_of(bars, as_of=None) == bars


def test_filter_as_of_accepts_a_key_extractor_for_non_ohlcv_types():
    from forecasting_agent.data_server.point_in_time import filter_as_of

    class Fake:
        def __init__(self, observed_on: date) -> None:
            self.observed_on = observed_on

    items = [Fake(date(2026, 8, 10)), Fake(date(2026, 8, 20))]

    result = filter_as_of(items, as_of=date(2026, 8, 15), key=lambda f: f.observed_on)

    assert len(result) == 1
    assert result[0].observed_on == date(2026, 8, 10)


def test_filter_as_of_default_key_still_works_for_ohlcv_bars_unchanged():
    from forecasting_agent.data_server.contracts import OHLCVBar
    from forecasting_agent.data_server.point_in_time import filter_as_of

    bars = [
        OHLCVBar(date=date(2026, 8, 10), open=1, high=1, low=1, close=1, volume=1),
        OHLCVBar(date=date(2026, 8, 20), open=1, high=1, low=1, close=1, volume=1),
    ]

    result = filter_as_of(bars, as_of=date(2026, 8, 15))

    assert len(result) == 1
    assert result[0].date == date(2026, 8, 10)
