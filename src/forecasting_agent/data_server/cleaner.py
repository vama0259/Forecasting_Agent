"""Hampel/MAD filter and deterministic outlier sanitization for market data."""

import numpy as np
import pandas as pd  # type: ignore[import-untyped]

from forecasting_agent.data_server.contracts import OHLCVBar


def _calc_mad(window_values: np.ndarray) -> float:
    """Calculate the Median Absolute Deviation (MAD) of values within a window."""
    med = np.median(window_values)
    return float(np.median(np.abs(window_values - med)))


def hampel_clip(
    bars: list[OHLCVBar],
    window: int = 20,
    threshold: float = 3.5,
) -> list[OHLCVBar]:
    """Apply a causal Hampel/MAD filter to clip outliers in close prices.

    For each bar, computes the causal rolling median and rolling MAD over the trailing
    `window` bars (including the current bar). If |close - median| > threshold * MAD,
    the close price is clipped (Winsorized) to:
        median + sign(close - median) * threshold * MAD
    and `is_outlier` is set to True.

    Args:
        bars: Sequence of OHLCVBar instances.
        window: Trailing window size for causal rolling statistics (default: 20).
        threshold: Number of MAD multipliers defining the outlier boundary (default: 3.5).

    Returns:
        A new list of OHLCVBar instances with clipped close prices and updated is_outlier flags.
    """
    if not bars:
        return []

    close_series = pd.Series([b.close for b in bars], dtype=float)

    # Causal rolling median and MAD (pandas default rolling window is strictly trailing / causal)
    rolling = close_series.rolling(window=window, min_periods=1)
    rolling_medians = rolling.median()
    rolling_mads = rolling.apply(_calc_mad, raw=True)

    cleaned_bars: list[OHLCVBar] = []
    for i, bar in enumerate(bars):
        med = float(rolling_medians.iloc[i])
        mad = float(rolling_mads.iloc[i])
        diff = bar.close - med
        bound = threshold * mad

        if abs(diff) > bound:
            if diff > 0:
                sign = 1.0
            elif diff < 0:
                sign = -1.0
            else:
                sign = 0.0
            clipped_close = med + sign * bound
            # In rare numerical float precision cases, ensure clipped_close stays positive
            clipped_close = max(clipped_close, 1e-6)
            cleaned_bars.append(bar.model_copy(update={"close": clipped_close, "is_outlier": True}))
        else:
            cleaned_bars.append(bar.model_copy(update={"is_outlier": False}))

    return cleaned_bars


def flag_circuit_locked(bars: list[OHLCVBar]) -> list[OHLCVBar]:
    """Flag circuit-freeze days per ADR-025: zero-volume trading days.

    ADR-025 defines a circuit freeze as 0% volume or an exact upper/lower band touch.
    Only the zero-volume trigger is implemented here — band-touch detection needs the
    previous day's close and each symbol's circuit percentage limit, neither of which
    OHLCVBar currently models. Tracked as a known gap, not fabricated with a proxy.

    Args:
        bars: Sequence of OHLCVBar instances.

    Returns:
        A new list of OHLCVBar instances with is_circuit_locked set on zero-volume bars.
    """
    return [bar.model_copy(update={"is_circuit_locked": bar.volume == 0}) for bar in bars]


__all__ = ["flag_circuit_locked", "hampel_clip"]
