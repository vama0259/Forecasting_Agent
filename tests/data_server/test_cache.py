# Unit tests for ParquetCache, including the covers_range date-window check (#36).
from datetime import date

from forecasting_agent.data_server.contracts import OHLCVBar


def _bar(d: date, price: float = 100.0) -> OHLCVBar:
    return OHLCVBar(date=d, open=price, high=price, low=price, close=price, volume=1000)


def test_get_returns_none_when_no_cache_file(tmp_path) -> None:
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    assert cache.get("RELIANCE.NS", "NSE") is None


def test_put_then_get_roundtrips_bars(tmp_path) -> None:
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    bars = [_bar(date(2026, 8, 10)), _bar(date(2026, 8, 11))]
    cache.put("RELIANCE.NS", "NSE", bars)

    result = cache.get("RELIANCE.NS", "NSE")
    assert result is not None
    assert [b.date for b in result] == [date(2026, 8, 10), date(2026, 8, 11)]


def test_covers_range_true_when_cached_bars_bracket_the_request(tmp_path) -> None:
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    cache.put("RELIANCE.NS", "NSE", [_bar(date(2026, 8, 1)), _bar(date(2026, 8, 15))])

    assert cache.covers_range("RELIANCE.NS", "NSE", date(2026, 8, 5), date(2026, 8, 10)) is True


def test_covers_range_false_when_request_is_a_completely_different_period(tmp_path) -> None:
    # The #36 bug scenario: cache holds a recent window, request is for an unrelated old date.
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    cache.put("RELIANCE.NS", "NSE", [_bar(date(2026, 7, 17)), _bar(date(2026, 8, 14))])

    assert cache.covers_range("RELIANCE.NS", "NSE", date(2024, 1, 1), date(2024, 1, 1)) is False


def test_covers_range_false_when_request_partially_extends_past_cached_bounds(tmp_path) -> None:
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    cache.put("RELIANCE.NS", "NSE", [_bar(date(2026, 8, 5)), _bar(date(2026, 8, 10))])

    # requested end (8/12) extends past the cached max (8/10) -- not fully covered
    assert cache.covers_range("RELIANCE.NS", "NSE", date(2026, 8, 5), date(2026, 8, 12)) is False


def test_covers_range_false_when_no_cache_exists(tmp_path) -> None:
    from forecasting_agent.data_server.cache import ParquetCache

    cache = ParquetCache(cache_dir=str(tmp_path))
    assert cache.covers_range("RELIANCE.NS", "NSE", date(2026, 8, 1), date(2026, 8, 2)) is False
