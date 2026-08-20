"""FII participant-wise derivative positioning and squeeze calculation primitives."""

import numpy as np
import pandas as pd


def compute_fii_positioning(df: pd.DataFrame) -> pd.DataFrame:
    """Compute FII Index Futures long/short ratios, net OI changes, and squeeze regime signals.

    Args:
        df: DataFrame containing FII contract columns:
            - 'fii_long_contracts' (or 'fii_long' or 'future_index_long')
            - 'fii_short_contracts' (or 'fii_short' or 'future_index_short')

    Returns:
        DataFrame with calculated metrics and 'squeeze_signal' column.
    """
    res = df.copy()

    col_map = {
        "future_index_long": "fii_long",
        "future_index_short": "fii_short",
        "fii_long_contracts": "fii_long",
        "fii_short_contracts": "fii_short",
    }
    for old_col, new_col in col_map.items():
        if old_col in res.columns and new_col not in res.columns:
            res[new_col] = res[old_col]

    if "fii_long" not in res.columns or "fii_short" not in res.columns:
        raise ValueError("DataFrame must contain FII long and short contract columns")

    res["fii_long"] = res["fii_long"].astype(float)
    res["fii_short"] = res["fii_short"].astype(float)
    res["total_contracts"] = res["fii_long"] + res["fii_short"]
    res["net_oi"] = res["fii_long"] - res["fii_short"]

    res["long_short_ratio"] = res["fii_long"] / res["total_contracts"].replace(0, np.nan)
    res["long_short_ratio"] = res["long_short_ratio"].fillna(0.5)

    res["net_oi_change_5d"] = res["net_oi"].diff(5).fillna(0.0)

    # Classify squeeze and positioning regimes
    conditions = [
        (res["long_short_ratio"] < 0.18),  # Extreme short crowding -> high squeeze risk
        (res["long_short_ratio"] > 0.78),  # Extreme long saturation -> long unwinding risk
        (res["long_short_ratio"] < 0.35) & (res["net_oi_change_5d"] < 0),  # Aggressive short build
        (res["long_short_ratio"] > 0.55) & (res["net_oi_change_5d"] > 0),  # Bullish expansion
    ]
    choices = [
        "extreme_short_squeeze",
        "long_exhaustion",
        "bearish_buildup",
        "bullish_expansion",
    ]
    res["squeeze_signal"] = np.select(conditions, choices, default="neutral")

    return res
