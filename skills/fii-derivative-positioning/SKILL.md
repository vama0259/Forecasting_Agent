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

## Institutional Context: Participant-wise F&O Disclosures
In the Indian market, the National Stock Exchange (NSE) publishes daily participant-wise derivative open interest (OI) breakdown across four key participant groups: FIIs, DIIs, Pro (Proprietary Desks), and Clients (Retail).
Foreign Institutional Investors (FIIs) represent the dominant momentum and directional force in Index Futures (Nifty 50 and Bank Nifty).

## Core Positioning Metrics

1. **FII Long/Short Ratio**:
   `long_short_ratio = fii_long_contracts / (fii_long_contracts + fii_short_contracts)`
   - Measures the proportion of bullish contracts in the total FII index futures exposure.

2. **Net Open Interest**:
   `net_oi = fii_long_contracts - fii_short_contracts`
   - Expressed as net contracts. `net_oi_change_5d` tracks 5-day velocity of institutional positioning shifts.

## Key Market Regimes & Squeeze Signals

### 1. Extreme Short Squeeze Zone (`long_short_ratio < 0.18`)
- **Dynamics**: When FIIs hold over 82% short exposure, the market becomes structurally asymmetric. Short sellers must buy back contracts to exit.
- **Catalyst**: Any positive global macro catalyst, gap-up opening, or support defense triggers forced short-covering cascades.
- **Rule**: If `long_short_ratio < 0.18`, issue a **Short Squeeze Risk / Strong Bullish Mean Reversion** bias. Expect aggressive upside volatility.

### 2. Long Exhaustion / Overbought Zone (`long_short_ratio > 0.78`)
- **Dynamics**: When FII long exposure exceeds 78%, marginal institutional buying power in futures is exhausted.
- **Catalyst**: Any adverse headline or resistance rejection leads to swift long unwinding and sharp profit booking.
- **Rule**: If `long_short_ratio > 0.78`, issue a **Long Exhaustion / Vulnerable Top** warning with bearish tilt.

### 3. Bearish Build-up (`long_short_ratio < 0.35` with `net_oi_change_5d < 0`)
- **Dynamics**: Active expansion of short contracts without signs of exhaustion.
- **Rule**: When long ratio is between 0.18 and 0.35 and 5-day net OI is declining, follow the institutional trend with bearish continuation bias.

### 4. Bullish Expansion (`long_short_ratio > 0.55` with `net_oi_change_5d > 0`)
- **Dynamics**: FIIs actively adding fresh long positions above the neutral midpoint.
- **Rule**: Align with foreign institutional momentum with bullish trend bias.

## Python Exploration Script
When developing features in the exploration tier, utilize `skills.fii_derivative_positioning`:
```python
import skills.fii_derivative_positioning as fii_pos

fii_df = fii_pos.compute_fii_positioning(flows_df)
current_regime = fii_df["squeeze_signal"].iloc[-1]
ls_ratio = fii_df["long_short_ratio"].iloc[-1]
```
*(Note: Always inline relevant parsing and calculations into `/workspace/model.py` prior to submission).*

## Worked Example
- Date T: FII Index Futures Long = 18,500 contracts, Short = 112,000 contracts.
- Total Contracts = 130,500.
- Long/Short Ratio = 18,500 / 130,500 = **0.1418 (14.18%)**.
- Assessment: FIIs are in deep short territory (<15-18%).
- Actionable Signal: High probability short squeeze alert. Position for sharp mean-reversion rally on Nifty.
