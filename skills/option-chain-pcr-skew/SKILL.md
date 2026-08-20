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

## Microstructure & Core Metrics
Option writing on NSE is dominated by institutions and proprietary desks:
- Highest Call OI strike = Overhead resistance wall (`call_wall`).
- Highest Put OI strike = Downside support floor (`put_wall`).

1. **Put-Call Ratio (OI PCR)**:
   `pcr_oi = total_put_open_interest / total_call_open_interest`
   - `pcr_oi < 0.65`: **Extreme Oversold / High Call Saturation** (contrarian bullish bounce).
   - `pcr_oi > 1.35`: **Extreme Overbought / High Put Complacency** (vulnerable to profit-taking).
   - `0.85 <= pcr_oi <= 1.15`: **Balanced / Neutral Regime**.

2. **Max Pain Strike & Migration**:
   - `total_loss(K) = sum(call_oi * max(0, S - K)) + sum(put_oi * max(0, K - S))` across all strikes $K$.
   - The strike $K^*$ minimizing total buyer payout is Max Pain.
   - Upward migration indicates bullish consolidation; downward migration signals bearish drift.

## Decision Rules & Thresholds
1. **Contrarian Bullish Mean Reversion**: Spot tests `put_wall` AND `pcr_oi < 0.65` with put addition -> **Bullish Reversal (+1)**.
2. **Contrarian Bearish Rejection**: Spot tests `call_wall` AND `pcr_oi > 1.35` with call writing -> **Bearish Rejection (-1)**.
3. **Breakout Expansion**: Spot breaks above `call_wall` with negative Call OI change -> **Bullish Breakout**.

## Worked Example
- Spot Nifty = 24,100; Call Wall = 24,500; Put Wall = 24,000.
- Total Put OI = 45M, Total Call OI = 72M -> **PCR = 0.625** (<0.65 oversold). Max Pain = 24,200.
- Signal: Nifty testing 24,000 Put Wall in oversold PCR zone -> **Strong Bullish Rebound** toward 24,200.
