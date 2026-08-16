# Point-in-time filtering and data leakage prevention for market data.

from collections.abc import Callable
from datetime import date


# Raised when an as_of query date lies in the future relative to today.
class LeakageError(Exception):
    pass


# Filter items strictly up to the specified point-in-time date using key extractor.
def filter_as_of[T](
    items: list[T],
    as_of: date | None,
    key: Callable[[T], date] = lambda b: b.date,  # type: ignore[attr-defined]
) -> list[T]:
    if as_of is None:
        return items
    today = date.today()  # noqa: DTZ011
    if as_of > today:
        raise LeakageError(f"as_of date {as_of} is in the future relative to today ({today})")
    return [item for item in items if key(item) <= as_of]


__all__ = ["LeakageError", "filter_as_of"]
