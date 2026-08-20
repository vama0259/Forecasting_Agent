---
name: dii-sip-resilience
description: Evaluates DII mutual fund systematic investment plan (SIP) inflows and cash buffer absorption during foreign selloffs.
version: 1.0.0
available_from: 2026-01-01
target_agents:
  - dii
tags:
  - dii
  - sip
  - flows
  - mutual-funds
  - institutional-absorption
status: active
---

# DII SIP Resilience & Cash Buffer Framework

## Structural Foundation: Domestic Liquidity Floor
Domestic Institutional Investors (DIIs) — comprising domestic mutual funds, insurance companies (LIC), and pension funds (NPS, EPFO) — provide structural, sticky liquidity to Indian equities.
The cornerstone of this support is the monthly Systematic Investment Plan (SIP) inflow channel (~₹20,000 to ₹25,000+ Crore monthly rate in 2026), creating an uninterrupted gross buying demand of approximately ₹1,000 Crore per trading session.

## Core Analytical Mechanisms

### 1. Cash Buffer Deployment at Market Dislocation
- Domestic equity mutual funds typically maintain cash and equivalent holdings between 4% and 7% of total Assets Under Management (AUM).
- During global risk-off events or sharp FII liquidations, mutual fund asset managers selectively deploy accumulated cash buffers to accumulate high-conviction large-cap equities at depressed valuations.
- This creates clear "valuation floors" where downside price momentum decelerates.

### 2. Net Absorption Ratio
`absorption_ratio = dii_net_cash_buy / abs(fii_net_cash_sell)`
- **Full Absorption (`absorption_ratio >= 1.0`)**: DII buying fully matches or exceeds foreign outflows. Market forms durable intraday bases and support shelves.
- **Defensive Cushioning (`0.7 <= absorption_ratio < 1.0`)**: DII bids cushion the drop, but market drifts slightly lower due to net negative liquidity.
- **Overwhelmed Defense (`absorption_ratio < 0.7`)**: Heavy FII capitulation (> ₹5,000 Cr single-day outflow) outpaces domestic deployment, indicating downward continuation.

## Decision Rules & Thresholds

1. **High-Conviction Institutional Floor Defense**:
   - **Condition**: `fii_net_cash < -2500 Cr` AND `dii_net_cash > 2500 Cr` (`absorption_ratio >= 1.0`) while index is testing key moving averages (20-day or 50-day EMA).
   - **Signal**: Bullish reversal / support defense (+1 signal). Domestic liquidity is absorbing foreign supply.

2. **Structural Domestic Momentum**:
   - **Condition**: DII net cash buying positive for ≥ 5 consecutive sessions alongside positive or neutral FII flows.
   - **Signal**: Bullish trend continuation. Steady domestic compounding pushes broader market higher.

3. **Capitulation Alert**:
   - **Condition**: FII selloff > ₹6,000 Cr with DII buying < ₹2,000 Cr (`absorption_ratio < 0.35`).
   - **Signal**: Tactical bearish / risk-off. Wait for absorption ratio to normalize before bottom-fishing.

## Worked Example
- Date T: Global risk-off triggers FII net cash outflow of -₹4,200 Cr.
- DII Response: Domestic mutual funds deploy cash buffer, registering +₹4,850 Cr net cash buy.
- Absorption Ratio = 4850 / 4200 = **1.155 (115.5%)**.
- Price Action: Nifty opens down 1.2%, stabilizes at 50 EMA, and closes near intraday highs.
- **DII Assessment**: Domestic flows successfully neutralized foreign supply. High probability of upward follow-through on T+1.
