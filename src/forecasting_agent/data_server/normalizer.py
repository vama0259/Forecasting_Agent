"""Calendar alignment and causal forward-fill normalization for market data."""

from datetime import timedelta

from forecasting_agent.data_server.contracts import OHLCVBar


def align_calendar(
    bars: list[OHLCVBar],
    max_staleness_days: int = 3,
) -> list[OHLCVBar]:
    """Forward-fill missing trading days (weekdays) up to a staleness threshold.

    Iterates through the chronological bar series and fills missing trading days
    (Monday through Friday) using the last known bar. If the gap between known
    bars exceeds `max_staleness_days` trading days, no further bars are fabricated
    for that gap until the next real bar arrives.

    Args:
        bars: Sequence of OHLCVBar instances.
        max_staleness_days: Maximum consecutive missing trading days to forward-fill
            (default: 3).

    Returns:
        A new list of OHLCVBar instances with aligned trading calendar dates.
    """
    if not bars:
        return []

    sorted_bars = sorted(bars, key=lambda b: b.date)
    aligned: list[OHLCVBar] = [sorted_bars[0].model_copy()]

    for i in range(1, len(sorted_bars)):
        prev_bar = sorted_bars[i - 1]
        curr_bar = sorted_bars[i]

        curr_date = prev_bar.date + timedelta(days=1)
        staleness_count = 0

        while curr_date < curr_bar.date:
            # Check if curr_date is a trading day (Monday=0 ... Friday=4)
            if curr_date.weekday() < 5:
                staleness_count += 1
                if staleness_count <= max_staleness_days:
                    filled_bar = prev_bar.model_copy(update={"date": curr_date})
                    aligned.append(filled_bar)
            curr_date += timedelta(days=1)

        aligned.append(curr_bar.model_copy())

    return aligned


__all__ = ["align_calendar"]
