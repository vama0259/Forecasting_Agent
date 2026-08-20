---
name: fii-derivative-positioning
description: Analyzes FII participant-wise Index Futures open interest and long/short positioning ratios to detect squeeze and exhaustion regimes.
version: 1.0.0
available_from: 2026-01-01
target_agents:
  - fii
tags:
  - fii
  - derivatives
  - futures
  - positioning
  - squeeze
  - flows
status: active
---

# FII Derivative Positioning & Squeeze Framework

## Core Positioning Metrics
NSE publishes daily participant-wise derivative open interest (OI) for FIIs, DIIs, Prop, and Retail.
FII Index Futures exposure provides key directional and squeeze signals:
1. `long_short_ratio = fii_long_contracts / (fii_long_contracts + fii_short_contracts)`
2. `net_oi = fii_long_contracts - fii_short_contracts`
3. `net_oi_change_5d = net_oi - net_oi(t-5)` (5-day positioning velocity)

## Market Regimes & Decision Rules

1. **Extreme Short Squeeze Zone (`long_short_ratio < 0.18`)**:
   - Over 82% short exposure creates structural asymmetry.
   - Any positive catalyst triggers forced short covering cascades.
   - Rule: Issue **Short Squeeze / Strong Bullish Mean Reversion** bias.

2. **Long Exhaustion Zone (`long_short_ratio > 0.78`)**:
   - Institutional buying power in futures is exhausted (>78% long).
   - Vulnerable to swift long unwinding upon resistance rejection.
   - Rule: Issue **Long Exhaustion / Vulnerable Top** warning with bearish tilt.

3. **Bearish Build-up (`0.18 <= long_short_ratio < 0.35` and `net_oi_change_5d < 0`)**:
   - Persistent addition of fresh short contracts.
   - Rule: Follow institutional trend with **Bearish Continuation** bias.

4. **Bullish Expansion (`long_short_ratio > 0.55` and `net_oi_change_5d > 0`)**:
   - FIIs actively adding fresh long positions above neutral midpoint.
   - Rule: Align with foreign momentum with **Bullish Expansion** bias.

## Python Exploration Script
When developing features in exploration tier, use `skills.fii_derivative_positioning`:
```python
import skills.fii_derivative_positioning as fii_pos

fii_df = fii_pos.compute_fii_positioning(flows_df)
current_regime = fii_df["squeeze_signal"].iloc[-1]
```
*(Note: Always inline relevant calculations into `/workspace/model.py` prior to submission).*

## Worked Example
- FII Long Contracts: 18,500, Short Contracts: 112,000 (Total = 130,500).
- Long/Short Ratio = 18,500 / 130,500 = **0.1418 (14.2%)**.
- Assessment: FIIs in deep short territory (<18%).
- Signal: High probability **Short Squeeze Alert**; position for mean-reversion upside on Nifty.
