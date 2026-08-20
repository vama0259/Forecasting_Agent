"""Wyckoff Volume Spread Analysis (VSA) calculation primitives."""

import numpy as np
import pandas as pd


def compute_wyckoff_vsa(df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
    """Compute rolling Wyckoff Volume Spread Analysis (VSA) metrics and signals.

    Args:
        df: DataFrame containing OHLCV and delivery columns:
            'high', 'low', 'close', and optionally 'delivery_qty' or 'volume'.
        window: Lookback rolling window for mean and standard deviation baseline.

    Returns:
        DataFrame with computed metrics and 'vsa_signal' column.
    """
    res = df.copy()
    if "high" not in res.columns or "low" not in res.columns or "close" not in res.columns:
        raise ValueError("DataFrame must contain 'high', 'low', and 'close' columns")

    res["spread"] = res["high"] - res["low"]
    rolling_spread = res["spread"].rolling(window=window, min_periods=max(1, window // 2)).mean()
    res["spread_ratio"] = res["spread"] / rolling_spread.replace(0, np.nan)
    res["spread_ratio"] = res["spread_ratio"].fillna(1.0)

    # Use delivery_qty if available, otherwise volume
    vol_col = "delivery_qty" if "delivery_qty" in res.columns else "volume"
    if vol_col not in res.columns:
        res[vol_col] = 1.0

    vol_series = res[vol_col].astype(float)
    vol_mean = vol_series.rolling(window=window, min_periods=max(1, window // 2)).mean()
    vol_std = vol_series.rolling(window=window, min_periods=max(1, window // 2)).std()
    res["delivery_zscore"] = (vol_series - vol_mean) / vol_std.replace(0, np.nan)
    res["delivery_zscore"] = res["delivery_zscore"].fillna(0.0)

    # Intraday close location within bar range [0.0, 1.0]
    denom = res["spread"].replace(0, np.nan)
    res["close_position"] = (res["close"] - res["low"]) / denom
    res["close_position"] = res["close_position"].fillna(0.5)

    # Vectorized signal classification
    conditions = [
        # Stopping Volume: High delivery effort, moderate spread, close in upper half
        (res["delivery_zscore"] > 1.5) & (res["spread_ratio"] <= 1.2) & (res["close_position"] >= 0.5),
        # Upthrust / Climax: High volume effort, close in bottom half
        (res["delivery_zscore"] > 1.2) & (res["close_position"] <= 0.4),
        # Accumulation: Strong volume, strong close
        (res["delivery_zscore"] > 1.0) & (res["close_position"] >= 0.7),
        # Distribution: Strong volume, weak close
        (res["delivery_zscore"] > 1.0) & (res["close_position"] <= 0.3),
        # No Demand: Low volume test near highs
        (res["delivery_zscore"] < -0.8) & (res["spread_ratio"] < 0.8) & (res["close_position"] >= 0.5),
        # No Supply: Low volume test near lows
        (res["delivery_zscore"] < -0.8) & (res["spread_ratio"] < 0.8) & (res["close_position"] < 0.5),
    ]
    choices = ["stopping_volume", "upthrust", "accumulation", "distribution", "no_demand", "no_supply"]
    res["vsa_signal"] = np.select(conditions, choices, default="neutral")

    return res
