---
parent: "[[Forecasting Agent]]"
---
# Metrics

Reference for how forecast quality is measured. The decision itself is [[Architecture|ADR-011]] (metric stack) and [[Architecture|ADR-012]] (harness isolation). This note is the full landscape those ADRs were chosen from.

## The trap

**RMSE / MAE on raw price is the metric that ruins forecasting projects.** Predict "tomorrow = today" and the score looks excellent while the skill is exactly zero. Any metric computed on *price levels* rewards persistence. Everything below operates on **returns, direction, or probability** instead.

## A — Point-forecast error ("predict a number")

| Metric | What it does | Verdict |
|---|---|---|
| RMSE / MAE on price | Squared / absolute error on levels | ❌ Never — persistence wins for free |
| RMSE / MAE on returns | Same, on % change | ⚠️ Acceptable, interpretable |
| MAPE | % error, scale-free | ⚠️ Explodes near zero, asymmetric penalty |
| sMAPE | Symmetric MAPE | ⚠️ Fixes asymmetry, still unstable near zero |
| **MASE** | Error **scaled against a naive baseline** | ✅ **Chosen (ADR-011 layer 1).** MASE < 1 = beat naive. Self-normalizing across assets and horizons |
| Theil's U | Ratio vs naive forecast | ✅ Same spirit as MASE, older |

MASE's advantage: the baseline comparison is inside the number, so "is 0.03 good?" never has to be answered separately.

## B — Directional ("predict up or down")

| Metric | What it does | Verdict |
|---|---|---|
| Hit rate / directional accuracy | % correct up/down | ⚠️ Ignores confidence and magnitude — 55% on tiny moves scores the same as 55% on huge ones |
| Precision / recall / F1 | Per-class performance | ✅ Useful when up/down are imbalanced (bull markets) |
| MCC (Matthews) | Balanced correlation coefficient | ✅ Robust to class imbalance, single number |
| Magnitude-weighted hit rate | Correct calls weighted by move size | ✅ Fixes hit-rate's blind spot |

## C — Probabilistic ("predict a confidence or distribution")

Where LLM agents actually belong — better at "65% confident" than at "₹2,847.30".

| Metric | What it does | Verdict |
|---|---|---|
| **Brier score** | Squared error on a probability | ✅ **Chosen (ADR-011 layer 2).** Comparable to ForecastBench numbers in [[Research]] |
| Log loss | Punishes confident-and-wrong harshly | ✅ Good anti-overconfidence pressure on an LLM |
| CRPS | Brier generalized to full distributions | ✅ Gold standard if agents emit distributions rather than points |
| Pinball / quantile loss | Scores interval forecasts | ✅ For "80% chance between X and Y" |
| **Calibration curve** | Is "70% confident" right 70% of the time? | ✅ **Chosen (ADR-011 layer 2).** Essential — LLMs are systematically overconfident |
| PICP | Do 90% intervals contain truth 90% of the time? | ✅ Interval-honesty check |

Brier decomposes into **calibration + refinement**, which distinguishes "badly calibrated" from "genuinely uninformative".

## D — Economic ("did it make money")

| Metric | Note |
|---|---|
| Sharpe ratio | Return per unit volatility. Standard, but leakage inflates it spectacularly |
| **Sortino** | Sharpe punishing only *downside* vol. ✅ **Chosen (ADR-011 layer 3)** |
| Max drawdown / Calmar | Worst peak-to-trough — what actually makes people quit |
| Profit factor | Gross win ÷ gross loss |
| Expectancy | Hit rate × average payoff |
| **Cost-adjusted return** | ⚠️ Mandatory for India: STT, stamp duty, exchange fees, SEBI charges, GST. Strategies profitable pre-cost are routinely negative post-cost |

## E — Agent-specific meta-metrics

Score the *system*, not the forecast:

- **Skill vs baseline** — does the agent beat naive *and* plain ARIMA? If not, the agent layer is decoration
- **Regime consistency** — accuracy split across bull / bear / sideways. Single-regime performance is a bull-market artifact
- **Cost per forecast** — the reason for the DeepSeek switch ([[Architecture|ADR-009]]); needs measuring, not assuming
- **Latency per forecast** — required before any latency optimization work
- **Iterations to convergence** — how many code-write → run → fix cycles before improvement stops

## Two outputs, two scoring paths

The system emits two artifacts and one metric cannot score both:

| Output | Produced by | Scored with |
|---|---|---|
| Forecasting **model** (agent-written Python) | M6 sub-agents | MASE — model quality |
| **Call** (bull/bear + confidence, post-debate) | M7 orchestrator | Brier + calibration — decision quality |

M8 therefore has **two scoring paths**, reflected in the architecture diagram.

## The validity gate

Not a metric — a precondition. Failing it makes a run **invalid**, not low-scoring:

- Walk-forward / rolling-origin validation (never random K-fold on time series)
- Purged cross-validation with embargo periods
- Point-in-time data — no survivorship bias, no restated fundamentals
- Feature-lag audit — every feature must be available at prediction time

## Why the harness is isolated

See [[Architecture|ADR-012]]. The agent writes the models; it must not write the scorer. A leaky train/test split is the cheapest path to a high score and it fails *silently* — leakage produces a more convincing result, not an obviously broken one.
