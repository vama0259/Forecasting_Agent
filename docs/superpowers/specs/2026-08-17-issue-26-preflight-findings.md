---
type: adr
date: 2026-08-17
status: proposed
parent: "[[Forecasting Agent]]"
---

# Issue #26 Pre-flight Findings — the ladder is 1 rung, not 3

Fact-check run before writing the #26 spec. Every claim below is verified against code,
not inferred from docs. Several published claims turned out to be false.

## 0. BLOCKER — Layer 1 never scores the agent's forecast

**`EvalRequest.forecasts` is declared, length-validated, and then never read by any
computation.** `src/forecasting_agent/evaluation/pipeline.py` scores the *naive* forecast at
layer 1 (`:44-56`) and never references `request.forecasts`. The field appears in exactly two
places in `src/`, both in `types.py` (`:13` declaration, `:27` length check) — and nowhere else.

Layer 1 therefore computes `mean|Δy_test| / mean|Δy_train|` — the ratio of test-set volatility
to train-set volatility. It is a property of the *data*, not of any prediction.

**Verified by execution**, not by reading. A probe built three `EvalRequest`s identical except
for `forecasts` — a perfect oracle (`forecasts == returns`), a catastrophic one
(`-100 × returns`), and the all-zeros series every existing test uses:

```
PERFECT   layer1_per_fold=[0.373333, 1.806452, 0.432099, 0.505556, 1.939394]  mean=1.011367
TERRIBLE  layer1_per_fold=[0.373333, 1.806452, 0.432099, 0.505556, 1.939394]  mean=1.011367
ZEROS     layer1_per_fold=[0.373333, 1.806452, 0.432099, 0.505556, 1.939394]  mean=1.011367
```

Byte-identical. A perfect forecast and a catastrophically wrong one score the same.

**Why no test caught it:** every test supplies `forecasts=[0.0] * n`
(`test_pipeline.py:23`, `test_gate.py:19`). No test varies `forecasts` and asserts the score
moves. The field is constant across the whole suite, so its disconnection is invisible.

**The evaluator IS wired end-to-end — via the sandbox, not the harness.**
`sandbox/entrypoints/validate.py:31-35` loads `/tmp/eval_request.json` (written by the agent's
own `model.py`), validates it into an `EvalRequest`, and calls `evaluate()`. A `grep` of
`harness/src/pipeline/` finds nothing because the call is Python inside the container. #9
(Story 6, merged, PR #27) shipped this path.

**Blast radius — NOT latent. Real runs already produced these numbers.**
An earlier draft of this section claimed nothing was corrupted, on the basis that
`baselines/*/summary.csv` has no MASE column. That was wrong — it only checked the summary. The
per-symbol result JSONs in `baselines/2026-08-15_baseline-v2-thinking-fix/runs/*.json` each carry
a full `evalResult` with per-fold layer-1 values:

```
BHARTIARTL.NS  L1 mean = 0.9177   (reads as "beat naive")
HDFCBANK.NS    L1 mean = 0.9236   (reads as "beat naive")
HINDUNILVR.NS  L1 mean = 0.8647   (reads as "beat naive")
ICICIBANK.NS   L1 mean = 0.9558   (reads as "beat naive")
INFY.NS        L1 mean = 1.3516   (reads as "lost to naive")
KOTAKBANK.NS   L1 mean = 1.0638   (reads as "lost to naive")
```

**Every one of these is independent of what the agent forecast.** They are
`mean|Δy_test| / mean|Δy_train|` per fold — a property of the price series alone. A committed
50-symbol sweep therefore contains per-symbol "skill" scores that would be byte-identical if the
agent had predicted perfectly or catastrophically. This is the failure mode named above,
already realised: not a missing number, a *believable* one.

**Consequence for #26:** adding a rung to this ladder is premature. Rungs 2 and 3 are opponents
for a runner who is not currently on the track — naive would be racing ARIMA while the agent's
forecast sits unscored. **Fix layer 1 first.** It is a small, contained change and it is a strict
prerequisite for any baseline rung meaning anything.

## 1. The skill ladder does not exist in code

`docs/METRICS.md:80` and `docs/ARCHITECTURE.md:493` (ADR-029) both describe the ladder as
`naive → ARIMA → factor model → agent`. **Only rung 1 exists.**

- `src/forecasting_agent/evaluation/mase.py:20-26` — `naive_forecast()`, last-observed-carried-forward. The only forecasting baseline in the repo.
- `src/forecasting_agent/evaluation/mase.py:37-39` — `zero_forecast_mase()`, an all-zeros comparison reported as a diagnostic, not a rung.
- `src/forecasting_agent/evaluation/pipeline.py:44-93` — exactly three layers: L1 MASE, L2 Brier, L3 Sortino. No baselines module imported.

Not found anywhere in first-party code: `arima`, `pmdarima`, `auto_arima`, `statsmodels`
usage, `baselines.py`, `factors/`. `statsmodels==0.14.6`, `pmdarima==2.1.1`, `prophet==1.3.0`
are installed in `sandbox/requirements.txt:8,10,13` but **imported by nothing**.

So #26 does not add rung 3 to a 2-rung ladder. It adds rungs 2 *and* 3 to a 1-rung ladder.

## 2. Three published documents assert baselines that do not ship

- `docs/METRICS.md:80` — ladder includes ARIMA. False.
- `docs/ARCHITECTURE.md:493` — same ladder. False.
- `scripts/generate_pptx.py:1465` — "Implements ARIMA and Exponential Smoothing as statistical
  baselines"; also `:381-382` "Baseline Statistical Anchor / ARIMA, Exponential Smoothing, and
  rolling volatility modeling". **A generated pitch deck asserts a shipped baseline that does
  not exist.**

This is evidence for the sequencing argument in section 5: unverifiable claims have already
escaped into external-facing material once.

## 3. `FeatureLagAudit` was never built, and cannot be built yet

Issue #26 acceptance criteria require "each factor passes M8's `FeatureLagAudit` individually".
That component does not exist. Searched `FeatureLagAudit`, `feature_lag`, `lag_audit`,
`lookahead`, `causal` across `src/`, `tests/`, `harness/`, `sandbox/` — **docs only**
(`docs/ARCHITECTURE.md:430`, `:159`, `docs/METRICS.md:113`).

The M8 spec documents this as a knowing deferral, and states the blocking reason:

> `docs/superpowers/specs/2026-08-14-m8-evaluation-engine-design.md:339` — "the feature-lag gate
> item has no input to audit. `EvalRequest` carries no feature provenance, so 'no forecast at t
> uses data stamped > t' cannot be computed, and the corresponding test cannot be written."

`:318` defers it to "whichever story first attaches provenance to a feature."

**Consequence for sequencing:** `FeatureLagAudit` cannot be front-loaded ahead of a feature
producer — there would be nothing to audit. A platform-owned factor library is plausibly the
cheapest first producer with controlled provenance, which makes the audit a *consequence* of
the factor library, not a prerequisite for it.

What does exist, and is narrower than its name suggests:
- `src/forecasting_agent/evaluation/gate.py:17-18` — one point-in-time check,
  `max(timestamps) > as_of`. That is the entire leakage gate.
- `src/forecasting_agent/data_server/point_in_time.py:8,30` — `LeakageError` guards data *fetch*,
  not feature construction.
- `data_server/cleaner.py:20-41`, `normalizer.py:1` — causality asserted in docstrings, verified
  by no audit machinery.

## 4. Two structural blockers for #26's proposed file layout

Issue #26 proposes `src/forecasting_agent/factors/` imported by
`src/forecasting_agent/evaluation/baselines.py`. Both collide with existing tests:

- `tests/evaluation/test_architecture.py:36-43` — asserts no file in `evaluation/` imports
  `{pandas, scipy, statsmodels, ...}`.
- `tests/evaluation/test_architecture.py:27-33` — asserts `evaluation/` imports no first-party
  module outside `forecasting_agent.evaluation`.
- `pyproject.toml:6-19` — declares no `statsmodels` / `pmdarima` project dependency.

These tests encode ADR-012's dependency-light, read-only judge. **This is a design decision, not
a test to edit casually.** Three options, unresolved:
1. Vendor factor code inside `evaluation/` (keeps the boundary, duplicates math).
2. Relax the architecture test (weakens ADR-012's isolation guarantee).
3. Compute baselines *outside* the evaluator and pass scores in as data on `EvalRequest`
   (keeps the judge dependency-free; moves the trust boundary).

Option 3 is the current front-runner — it preserves the property the tests exist to protect.

## 5. `PurgedWalkForward` does not purge, and rejects multi-day horizons

`src/forecasting_agent/evaluation/walk_forward.py:31-32` —
`if horizon > 1: raise NotImplementedError("horizon {n} > 1 requires purging which is not implemented")`.
`:41-42` — `split()` is a passthrough to sklearn `TimeSeriesSplit`; no purging logic of its own.

Any baseline rung is therefore constrained to horizon=1 until this is addressed.

## 6. Dependency reality for sequencing

- Issue #10 (4-agent participant system) is **OPEN, unimplemented**. `harness/src/agents/`
  contains only `price-anchor.ts`; no `fii-agent.ts`, `dii-agent.ts`, `retail-agent.ts`;
  `workspace/` does not exist at repo root.
- Issue #20 (p0, "Indian Moat Connectors") is titled **"blocks #10"**.
- #26 is p1; #19 and #20 are p0.

So #26 is not on #10's critical path in either direction — #10 is blocked by #20 regardless.

## Recommendation

**Step 1 — fix layer 1 so it scores `request.forecasts` (section 0). Blocking, small.**
Add a regression test that varies `forecasts` and asserts the score moves; the absence of that
test is why the bug survived. No baseline rung is meaningful until this lands.

**Step 2 — rung 2 (AR) only. Defer the factor library (rung 3).**

Implementation note for step 2: `tests/evaluation/test_architecture.py:36-43` forbids
`statsmodels` inside `evaluation/`, but `numpy` and `sklearn` are already used there
(`walk_forward.py:7`, `brier.py:5`). An **AR(p) model fit by ordinary least squares via
`np.linalg.lstsq` is ~20 lines of numpy** and needs no forbidden import, no new project
dependency, no architecture-test change, and no move of the trust boundary. This dissolves the
three-way design choice in section 4 rather than resolving it — prefer it.

Name it honestly: AR(p) on returns is `ARIMA(p,1,0)` on prices, a strict subset of ARIMA. Ship
the name that matches the code and correct the docs to match, rather than repeating the
overclaim documented in section 2.

Rationale:
- A baseline is a deterministic function of historical price data, so rung 3 is **fully
  retroactive** — it can be built later and used to re-score every prior run at zero cost.
  Re-running *agent* forecasts is not retroactive (LLM spend, non-determinism), but the baseline
  is not the agent.
- ARIMA needs no factor library, no `FeatureLagAudit`, no feature-provenance plumbing. Its
  dependencies are already installed.
- It takes the ladder from 1 rung to 2, and makes `generate_pptx.py:1465` true instead of false.
- The reusable asset across future verticals is the **baseline slot** — a seam where any
  vertical's boring model plugs in and is scored beside the agent. RSI/MACD/Bollinger do not
  travel beyond equities; the slot does. Build the slot thinly with ARIMA as its first occupant.

**Condition on the deferral:** no "our agent beats X" claim ships in any deck, README, or pitch
until at least rung 2 exists. Section 2 shows this failure mode has already occurred once.

**Correction to record:** ADR-029 and issue #26 both imply `FeatureLagAudit` gates the factor
library. Per section 3 the dependency runs the other way. ADR-029 should be amended.
