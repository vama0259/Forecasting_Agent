---
name: option-chain-pcr-skew
description: Examines strike-wise open interest concentration, max pain level migration, and Put-Call Ratio (PCR) skew dynamics.
version: 1.0.0
available_from: 2026-01-01
target_agents:
  - retail
  - fii
tags:
  - options
  - pcr
  - max-pain
  - open-interest
  - skew
  - derivatives
status: active
---

# Option Chain, PCR & Max Pain Skew Framework

## Microstructure Mechanics: Option Writers vs Option Buyers
In Indian index options (Nifty and Bank Nifty weekly/monthly contracts), option writing is dominated by well-capitalized institutions and proprietary desks. As a consequence:
- **Highest Call Open Interest (OI)** strikes represent strong overhead resistance walls.
- **Highest Put Open Interest (OI)** strikes represent strong downside support floors.

## Core Option Chain Metrics

1. **Put-Call Ratio (OI PCR)**:
   `pcr_oi = total_put_open_interest / total_call_open_interest`
   - PCR is a classic contrarian sentiment indicator:
     - `pcr_oi < 0.65`: **Extreme Oversold / High Call Saturation**. Market is primed for a sharp short-covering bounce.
     - `pcr_oi > 1.35`: **Extreme Overbought / High Put Complacency**. Upside becomes capped; vulnerable to sudden profit-taking.
     - `0.85 <= pcr_oi <= 1.15`: **Balanced / Neutral Regime**.

2. **Max Pain Strike & Migration**:
   - Max Pain is the strike price where option buyers collectively lose the most money upon expiration (and option writers keep the maximum premium).
   - `total_loss(K) = sum(call_oi * max(0, S - K)) + sum(put_oi * max(0, K - S))` evaluated across all strikes $K$.
   - The strike $K^*$ minimizing total payout is the Max Pain level.
   - **Migration Velocity**: An upward shift in Max Pain during the expiry week indicates bullish consolidation; a downward shift signals bearish drift.

3. **Strike Concentration & Walls**:
   - `call_wall = argmax(call_oi_by_strike)`
   - `put_wall = argmax(put_oi_by_strike)`
   - Expected expiry trading range is bounded by $[put\_wall, call\_wall]$.

## Decision Rules & Thresholds

1. **Contrarian Bullish Mean Reversion**:
   - **Condition**: Index spot approaches `put_wall` AND `pcr_oi < 0.65` with put addition (+dPut_OI).
   - **Signal**: High confidence Bullish Reversal (+1). Writers are aggressively defending the put wall against panicking retail buyers.

2. **Contrarian Bearish Rejection**:
   - **Condition**: Index spot approaches `call_wall` AND `pcr_oi > 1.35` with call writing addition.
   - **Signal**: Bearish Resistance Rejection (-1).

3. **Breakout Expansion Trigger**:
   - **Condition**: Price crosses above `call_wall` accompanied by negative Call OI change (short covering from call writers).
   - **Signal**: Bullish Breakout with expanding volatility.

## Worked Example
- Spot Nifty = 24,100.
- Highest Call OI = 24,500 (12.5M contracts). Highest Put OI = 24,000 (14.2M contracts).
- Total Put OI = 45M, Total Call OI = 72M -> **PCR = 45 / 72 = 0.625**.
- Max Pain Strike = 24,200.
- Analysis: Nifty is trading just 100 points above the 24,000 Put Wall, PCR is deep in oversold territory (<0.65), and Max Pain sits 100 points above spot.
- **Signal**: Strong Bullish Rebound expectation towards Max Pain (24,200+).
