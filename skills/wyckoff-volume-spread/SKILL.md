---
name: wyckoff-volume-spread
description: Wyckoff Volume Spread Analysis (VSA) comparing price spread and delivery volume to detect institutional accumulation and distribution.
version: 1.0.0
available_from: 2026-01-01
target_agents:
  - retail
  - price
tags:
  - wyckoff
  - vsa
  - volume-spread
  - delivery
  - microstructure
status: active
---

# Wyckoff Volume Spread Analysis (VSA)

## Core Philosophy: Effort versus Result
Wyckoff Volume Spread Analysis operates on the foundational market law of Effort versus Result. In Indian equity and derivative markets:
- **Effort** is represented by trading volume and security-level delivery quantity from NSE Bhavcopy disclosures.
- **Result** is the price spread (High minus Low) and the location of the close relative to the bar's range.

When effort and result diverge, smart money (institutional accumulation or distribution) is actively taking liquidity from retail participants.

## Key Market Regimes & VSA Signatures

### 1. Stopping Volume & Absorption (Bullish)
- **Signature**: Price in a markdown or retesting support prints an average-to-wide spread down bar, but delivery volume spikes to extreme levels (Delivery Z-Score > +1.5) and the close recovers into the upper 50% of the bar.
- **Interpretation**: Institutional buying absorbs panicking retail supply at wholesale prices. The large volume fails to push price lower (High Effort, Low Bearish Result).
- **Rule**: If `delivery_zscore > 1.5` AND `close_position >= 0.5` after a down move, register an **Accumulation / Stopping Volume** signal with bullish bias.

### 2. Upthrust / Buying Climax (Bearish)
- **Signature**: Wide spread bar pushing to new local highs on high delivery volume, but the close finishes in the bottom 40% of the range with a prominent upper shadow.
- **Interpretation**: Smart money feeds supply into retail breakout buyers (High Effort, Failed Bullish Result).
- **Rule**: If `delivery_zscore > 1.2` AND `close_position <= 0.4` near resistance, register an **Upthrust / Distribution** signal with bearish bias.

### 3. No Supply Test (Bullish Confirmation)
- **Signature**: Price pulls back into prior accumulation support on narrow spread (Spread Ratio < 0.8) and low volume (Delivery Z-Score < -1.0), closing in the upper half.
- **Interpretation**: Confirms floating supply has been successfully absorbed. Path of least resistance is upward.
- **Rule**: If `delivery_zscore < -0.8` AND `spread_ratio < 0.8` AND `close_position >= 0.5`, register a **No Supply Test** signal.

### 4. No Demand Test (Bearish Confirmation)
- **Signature**: Price rallies toward prior breakdown resistance on narrow spread and low volume, closing in the lower half.
- **Interpretation**: Lack of institutional buying interest at higher prices.
- **Rule**: If `delivery_zscore < -0.8` AND `spread_ratio < 0.8` AND `close_position < 0.5`, register a **No Demand Test** signal.

## Quantitative Formulas & Metrics

1. **Spread Ratio**:
   `spread = High - Low`
   `spread_ratio = spread / rolling_mean(spread, 20)`

2. **Delivery Z-Score**:
   `delivery_zscore = (delivery_qty - rolling_mean(delivery_qty, 20)) / rolling_std(delivery_qty, 20)`

3. **Close Position Range [0.0, 1.0]**:
   `close_position = (Close - Low) / max(High - Low, 1e-6)`

## Python Exploration Script
When operating on the explore tier, import `skills.wyckoff_volume_spread` to access `compute_wyckoff_vsa(df)`:
```python
import skills.wyckoff_volume_spread as vsa

vsa_df = vsa.compute_wyckoff_vsa(ohlcv_df)
latest_signal = vsa_df["vsa_signal"].iloc[-1]
```
*(Note: Remember to inline any calculation logic into your final `/workspace/model.py` before submission).*

## Worked Example
- Day T: Stock XYZ drops 2.5%, High=1020, Low=980, Close=1008.
- Spread = 40 (Average spread = 25 -> Spread Ratio = 1.6).
- Delivery Volume = 4.2M shares (20-day mean = 1.8M, std = 0.8M -> Delivery Z-Score = +3.0).
- Close Position = (1008 - 980) / 40 = 0.70 (top 30% of range).
- **VSA Classification**: Stopping Volume / Institutional Absorption -> Forecast next-day rebound with high conviction.
