"""Point-in-time filtering and data leakage prevention for market data."""

from datetime import date

from forecasting_agent.data_server.contracts import OHLCVBar


class LeakageError(Exception):
    """Raised when an as_of query date lies in the future relative to today."""


def filter_as_of(bars: list[OHLCVBar], as_of: date | None) -> list[OHLCVBar]:
    """Filter OHLCV bars strictly up to the specified point-in-time date.

    Args:
        bars: List of OHLCVBar models.
        as_of: The point-in-time cutoff date. If None, returns bars unchanged.

    Returns:
        A list of OHLCVBar instances up to and including the as_of date.

    Raises:
        LeakageError: If as_of is greater than today's date.
    """
    if as_of is None:
        return bars

    today = date.today()  # noqa: DTZ011
    if as_of > today:
        raise LeakageError(f"as_of date {as_of} is in the future relative to today ({today})")

    return [b for b in bars if b.date <= as_of]


__all__ = ["LeakageError", "filter_as_of"]
