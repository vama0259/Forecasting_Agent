---
type: adr
parent: "[[Forecasting Agent]]"
date: 2026-08-14
status: decided
---
# Product Strategy, ICP & Founder Roadmap

## 1. Product Vision
**Claude Code for Industry Analysis.**
- Primary ICP for Day 1: **Discretionary Indian Equity Swing Traders & Independent Research Analysts**.
- Core Value Proposition: Multi-agent debate modeling market participant intent (FII, DII, Retail) with zero-leakage, code-verified forecasts.

## 2. Target Persona & Job-To-Be-Done (JTBD)
| Persona | Pain Point | How Forecasting Agent Solves It |
|---|---|---|
| Active Swing Trader | Drowning in noisy Twitter/Moneycontrol tips, no structured participant data | Synthesizes FII/DII flows, delivery %, and macro into actionable 5-day scenarios |
| Research Analyst | Spends 3 hours compiling DCF/bhavcopy/options data for 1 stock | Autonomous agent writes code, runs backtests, and produces audit-ready evidence in 3 minutes |

## 3. Product Output Structure (The Executive Digest Card)
Every forecast run must emit a structured 5-point executive card:
1. **Directional Bias & Calibrated Probability:** e.g., `Bullish (68% Confidence)`
2. **Participant Alignment:** Who is buying vs selling (FII vs DII vs Client OI).
3. **Core Catalysts & Key Drivers:** Top 3 factual evidence points from verified news & bhavcopy.
4. **Bull vs Bear Scenario Pathways:** Specific upside target vs downside risk.
5. **Thesis Invalidation Price:** Concrete stop loss / invalidation level.

## 4. Retention & Feedback Loops
- **Active Forecast Tracker:** Automated daily tracking of open forecasts against live closing prices.
- **Post-Horizon Audit:** Brier score & MASE resolution delivered to user upon horizon completion.

## 5. Compliance & Regulatory Gating
- Structured as **Autonomous Research & Intelligence Tooling** (Educational / Quant Research).
- Strict non-advisory disclaimers on all UI surfaces and exports.
- Scenario-based probabilistic analysis rather than direct execution orders.
