---
name: wyckoff-volume-spread
description: Implements Richard Wyckoff Volume Spread Analysis (VSA) for detecting institutional accumulation, distribution, and effort vs result anomalies.
version: 1.0.0
available_from: 2026-01-01
target_agents:
  - retail
  - price
tags:
  - vsa
  - wyckoff
  - volume
  - spread
  - accumulation
  - distribution
  - microstructure
status: active
---

# Wyckoff Volume Spread Analysis (VSA) Framework

## Core Philosophy: Effort vs. Result
Volume represents **Effort** (institutional capital activity) and price spread (High - Low) represents **Result**.
When Effort and Result diverge, market imbalances signal imminent directional shifts.

## Key VSA Bar Classifications

1. **Stopping Volume (Absorption of Supply)**:
   - High delivery volume on a down bar closing in the upper half of range.
   - Smart money absorbing panicking retail supply at support floors -> Bullish reversal.

2. **Upthrust / Buying Climax**:
   - Wide spread up bar with heavy volume closing in lower half of range.
   - Institutional distribution into retail breakout FOMO -> Bearish reversal.

3. **No Demand / Low Volume Test**:
   - Narrow spread up bar with below-average volume closing off highs.
   - Lack of professional buying interest -> Bearish continuation / rejection.

4. **No Supply / Low Volume Test**:
   - Narrow spread down bar with below-average volume closing off lows.
   - Absence of institutional selling pressure -> Bullish continuation / base confirmation.

## Decision Rules & Thresholds
- `delivery_zscore > 1.5` and `spread_ratio <= 1.2` and `close_position >= 0.5` -> **Stopping Volume (Bullish)**
- `delivery_zscore > 1.2` and `close_position <= 0.4` -> **Upthrust / Climax (Bearish)**
- `delivery_zscore > 1.0` and `close_position >= 0.7` -> **Accumulation (Bullish)**
- `delivery_zscore > 1.0` and `close_position <= 0.3` -> **Distribution (Bearish)**
- `delivery_zscore < -0.8` and `spread_ratio < 0.8` and `close_position >= 0.5` -> **No Demand (Bearish)**
- `delivery_zscore < -0.8` and `spread_ratio < 0.8` and `close_position < 0.5` -> **No Supply (Bullish)**

## Python Exploration Script
When developing features in exploration tier, use `skills.wyckoff_volume_spread`:
```python
import skills.wyckoff_volume_spread as vsa

df_vsa = vsa.compute_wyckoff_vsa(df, window=20)
signal = df_vsa["vsa_signal"].iloc[-1]
```
*(Note: Always inline relevant calculations into `/workspace/model.py` prior to submission).*

## Worked Example
- Bar High: 2520, Low: 2480, Close: 2510 (Spread = 40, Close Pos = 0.75).
- Volume / Delivery Z-score: +2.1 (Ultra-high effort).
- Interpretation: Ultra-high volume on wide bar closing near high indicates institutional accumulation.
- Signal: Strong Bullish Accumulation.
