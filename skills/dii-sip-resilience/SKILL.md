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
Domestic Institutional Investors (mutual funds, insurance/LIC, pension funds) provide structural liquidity via monthly SIP inflows (~₹20,000-₹25,000+ Cr/month), generating ~₹1,000 Cr daily gross buying demand.

## Core Mechanisms & Net Absorption Ratio
`absorption_ratio = dii_net_cash_buy / abs(fii_net_cash_sell)`

1. **Full Absorption (`absorption_ratio >= 1.0`)**:
   - DII cash deployment matches or exceeds foreign outflows.
   - Market establishes durable support bases.
2. **Defensive Cushioning (`0.7 <= absorption_ratio < 1.0`)**:
   - DII bids cushion decline, but net liquidity remains mildly negative.
3. **Overwhelmed Defense (`absorption_ratio < 0.7`)**:
   - Heavy FII capitulation outpaces domestic deployment; downward continuation.

## Decision Rules & Thresholds
1. **High-Conviction Floor Defense**: `fii_net_cash < -2500 Cr` AND `dii_net_cash > 2500 Cr` (`absorption_ratio >= 1.0`) while testing 20/50-day EMA -> **Bullish Support Defense (+1)**.
2. **Structural Domestic Momentum**: DII net cash positive for >= 5 consecutive sessions alongside neutral/positive FII -> **Bullish Trend Continuation**.
3. **Capitulation Alert**: FII outflow > ₹6,000 Cr with DII buying < ₹2,000 Cr (`absorption_ratio < 0.35`) -> **Tactical Bearish / Risk-Off**.

## Worked Example
- FII Net Cash Outflow: -₹4,200 Cr. DII Net Cash Buy: +₹4,850 Cr.
- Absorption Ratio = 4850 / 4200 = **1.155 (115.5%)**.
- Price Action: Nifty tests 50 EMA and closes near intraday highs.
- Signal: Domestic flows neutralized foreign supply -> **Bullish Continuation**.
