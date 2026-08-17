---
type: adr
date: 2026-08-17
status: decided
parent: "[[Forecasting Agent]]"
---

# Baseline Comparison — the agent does not beat forecasting nothing

## What was run

`scripts/run_baseline_ladder.py` scores a ladder of trivial statistical baselines through the
**same** `forecasting_agent.evaluation.evaluate()` the agent is graded by — same splitter defaults
(`horizon=1, min_train_size=3, n_splits=5`), same 10 Nifty symbols, same `as_of=2026-08-14` window
the agent's `baselines/2026-08-15_baseline-v2-thinking-fix` sweep used.

Every baseline is causal: entry `i` is computed strictly from `returns[:i]`.

| rung | forecast for day i | directional call |
| --- | --- | --- |
| `zero` | `0.0` | 0.5 (abstain) |
| `naive` | `returns[i-1]` | 0.5 (abstain) |
| `drift` | `mean(returns[:i])` | expanding share of up-days |
| `ewma_0.3` | exponential smoothing, α=0.3 | expanding share of up-days |

`ewma_0.3` is the head-to-head rung: it is *literally what the agent's prompt tells it to build*
("e.g. an exponential-smoothing estimate fit only on returns[0..i-1]", `single-agent.ts:231`).

## Result

A fresh 10-symbol agent sweep was run for this comparison
(`baselines/2026-08-17_baseline-v3-layer1-fixed/`, 10/10 pass), because every earlier sweep predates
the Layer-1 fix — see "the void number" below. Ladder and agent both scored `--as-of 2026-08-17`:

```
model          L1 MASE   L1 zero   ratio    beats   L2 Brier  L3 Sortino
------------------------------------------------------------------------
zero             0.650     0.650    1.00     0/50      0.250         nan
drift            0.661     0.650    1.02    11/50      0.256       0.058
AGENT            0.732     0.655    1.12     4/50      0.256       0.432
ewma_0.3         0.729     0.650    1.12     5/50      0.256       0.058
naive            0.966     0.650    1.49     2/50      0.250         nan
```

`ratio` = each row's own MASE divided by its own zero-forecast MASE, so rows measured on slightly
different bar counts stay comparable. `>1.00` means worse than forecasting nothing.

### The agent is an EWMA with extra steps

**The agent lands on 1.12. `ewma_0.3` lands on 1.12.** Brier 0.256 against 0.256. Two independent
implementations — one a DeepSeek agent with market-data tools, a Docker sandbox, thinking mode and
a ~100s round trip; the other four lines of numpy — score the same to three significant figures.

Per-symbol, the agent's ratio sits in a tight **1.06–1.15** band across all ten. This is systematic,
not sampling noise.

| symbol | dir | prob | horizon | L1 agent | L1 zero | ratio | beats | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BHARTIARTL.NS | up | 0.60 | 10 | 0.692 | 0.603 | 1.15 | 0/5 | 0.256 |
| HDFCBANK.NS | down | 0.55 | 10 | 0.673 | 0.595 | 1.13 | 0/5 | 0.247 |
| HINDUNILVR.NS | down | 0.55 | 10 | 0.639 | 0.575 | 1.11 | 0/5 | 0.275 |
| ICICIBANK.NS | up | 0.58 | 10 | 0.738 | 0.678 | 1.09 | 1/5 | 0.259 |
| INFY.NS | up | 0.58 | 10 | 0.800 | 0.754 | 1.06 | 1/5 | 0.250 |
| KOTAKBANK.NS | up | 0.58 | 10 | 0.771 | 0.676 | 1.14 | 0/5 | 0.255 |
| LT.NS | up | 0.55 | 10 | 0.629 | 0.548 | 1.15 | 1/5 | 0.244 |
| RELIANCE.NS | up | 0.55 | 21 | 0.819 | 0.731 | 1.12 | 0/5 | 0.266 |
| SBIN.NS | down | 0.55 | 10 | 0.723 | 0.637 | 1.14 | 0/5 | 0.252 |
| TCS.NS | down | 0.56 | 5 | 0.836 | 0.754 | 1.11 | 1/5 | 0.256 |

Five findings, in order of how much they should change what gets built next:

1. **It does what the prompt tells it to, and nothing more.** `single-agent.ts:231` literally
   instructs it to produce "an exponential-smoothing estimate fit only on returns[0..i-1]". It
   complies, faithfully. The LLM contributes no measurable accuracy over the four-line version of
   that same instruction. Everything the harness adds — tools, sandbox, thinking mode — currently
   buys nothing on this metric.

2. **It does not beat forecasting nothing.** `zero` is 1.00, `drift` is 1.02, the agent is 1.12,
   beating the zero baseline on **4 of 50 folds (8%)**.

3. **Its probabilities show no calibration skill, but it is not uniquely bad.** Agent 0.256,
   `drift` 0.256, `ewma_0.3` 0.256, against 0.250 for a constant `p=0.5`. Everything that takes an
   actual directional view on this data pays slightly for the privilege. The honest read is "no
   demonstrated skill", not "negative skill".

4. **The one metric the agent leads on is the least trustworthy.** L3 Sortino 0.432 against 0.058.
   Sortino over ~85 daily bars with sparse positions is extremely noisy and highly sensitive to a
   couple of lucky days. Do not bank this until it survives many more sweeps.

5. **The headline signal still has no scorer at all.** Layers 1–3 grade `/workspace/model.py`, the
   statistics script the agent writes. What we actually ship — the structured
   `direction`/`probability`, and the debate consensus — is measured nowhere. Every "VALID" in
   `summary.csv` is `GateVerdict.status`, which only asserts the walk-forward split was well-formed.
   Note the `horizon` column above: 5, 10 and 21 days depending on the symbol, chosen freely by the
   LLM, while the debate path pins `horizon_days: 1`. **We have never measured the product.**

### The void number — do not use it

Reading the agent's MASE straight out of `baselines/2026-08-15_baseline-v2-thinking-fix/runs/*.json`
gives 1.067 against a 0.725 zero baseline — ratio **1.47**, which would rank the agent tied with
`naive` at the bottom of the ladder. That number is wrong, and wrong in the direction of being too
harsh: the real figure is 1.12, level with exponential smoothing.

That sweep ran 2026-08-15. `pipeline.py` did not read `EvalRequest.forecasts` until `79c27e8`,
*2026-08-17*, so every Layer-1 value in it scored a fixed naive baseline instead of the agent's
forecast — identical whether the agent forecast perfectly or catastrophically. Its Brier (0.262) is
unaffected, since Layer 2 always read its inputs correctly.

`scripts/run_baseline_ladder.py --compare-run-dir` cannot tell a pre-`79c27e8` run from a valid one,
so it now prints a warning on every use. **Only point it at agent runs recorded after `79c27e8`.**

## Comprehension gate (responsiveness check)

Question in plain language: *if I hand the scorer a perfect forecast instead of a bad one, does
the number move?*

Run on TCS.NS, 85 returns:

| forecast fed in | L1 MASE | L2 Brier |
| --- | --- | --- |
| oracle (`forecast == truth`) | 0.0000 | 0.0000 |
| anti-oracle (`forecast == -truth`) | 2.2526 | 1.0000 |
| zero | 1.1263 | 0.2500 |
| drift | 1.1879 | 0.2704 |

Fully responsive, and the arithmetic checks out — zero sits at exactly half the anti-oracle score,
which is forced, since `|0 − y|` is half of `|−y − y|`. This is not a repeat of the M8 fixed-baseline
bug: `pipeline.py` reads `EvalRequest.forecasts`, and the ladder moves when the forecast moves.

## Three defects found while running this

**1. The agent has been forecasting on stale data.** The MCP stdio client only inherits a fixed
env allowlist (`PATH`, `HOME`, …), so `ANGELONE_*` never reached the market-data server. Every
`fetch_ohlcv` fell through `AngelOneEquityPlugin failed … 'ANGELONE_API_KEY'` to the yfinance
fallback, which lags by a day — and `data_stale` was never surfaced to the agent. Fixed by adding
an `env` block to `mcp_servers.market` (`harness_config.yaml`) and the matching field to
`StdioMcpServerSchema` (`config.ts`), covered by a regression test that was confirmed to fail
without the fix. Post-fix live run: **0 fallback warnings**, bars through 2026-08-17.

**2. One failed participant kills the whole debate.** `runMultiAgentPipeline` types its output
`Record<string, AgentSignal | null>` — a null participant is a designed outcome. But
`run-real-debate.ts:120` casts that to `Record<ParticipantAgentName, AgentSignal>`, erasing the
null, and `orchestrator.ts:262` then dereferences `sig.direction` and throws
`TypeError: Cannot read properties of null`. Tonight's run died exactly there when `retail`
returned null. **Not fixed** — the right behaviour (drop the participant and renormalise weights,
or abort the debate) is a policy decision about degraded participants, not a null check.

**3. Three of four participants run degraded, and it doesn't change their vote.** Both stored
debate runs show `price` with `degraded: false` and `fii`/`dii`/`retail` all `degraded: true`,
yet their signals enter consensus anyway. Worth asking what a degraded participant's opinion is
actually worth.

## What the debate does to conviction

From the one complete 4-round run in `debate_rounds`:

| round | price | fii | dii | retail |
| --- | --- | --- | --- | --- |
| 1 | down 0.58 | down 0.56 | down 0.58 | down 0.58 |
| 2 | down 0.56 | down 0.55 | down 0.55 | down 0.55 |
| 3 | down 0.54 | down 0.52 | down 0.52 | **up 0.55** |
| 4 | — consensus: **down 0.51, confidence 0.21** — | | | |

Four participants start in near-unanimous agreement, debate for three rounds, and converge on
0.51 — a coin flip — with confidence collapsing from ~0.60 to 0.21. The debate is not resolving
disagreement; it is manufacturing it out of agreement, then reporting the resulting mush as
consensus. Note also that rounds 1–3 barely disagree, so the "adversarial" structure has almost
nothing to work with: the participants are highly correlated, which is what you would expect when
three of them are degraded and the fourth is the only one with real data.

## The call

**Stop adding forecasting machinery. Build the scorer for the headline signal first.**

The repo has spent recent stories on breadth — participant sub-agents, a 4-round adversarial
debate, consensus arithmetic — all layered on top of a signal that scores identically to four lines
of numpy and does not beat `return 0.0`. Debate between four participants that each reproduce
exponential smoothing does not average into skill; more structure on an unmeasured output is just
more unmeasured output.

Note the ladder is a *necessary* condition, not proof of skill: ~85 daily bars is a small sample,
and the gap between 1.00 and 1.12 is not large in absolute terms. What makes it damning is not the
size of the gap but its consistency — 1.06–1.15 on every symbol, and a 1.12 that is
indistinguishable from the trivial model the agent was told to imitate.

Concretely, in order:

1. **Score the shipped signal.** Persist each `direction`/`probability` with its `as_of`, then
   settle it against the realised close. Directional hit-rate and Brier against the 0.50 abstention
   floor. Until this exists no other work can be evaluated.
2. **Put the ladder in CI as a floor.** Any change that claims to improve forecasting must beat
   `drift` on the same window, or it did not improve forecasting.
3. **Then ask the cheap question before the expensive one:** the agent currently equals `ewma_0.3`.
   Before adding more agents, find out whether *any* prompt makes one agent beat `drift`. If not,
   four of them debating will not either.
4. **Only then** revisit whether the debate protocol adds anything over a single participant.

## Reproducing

```bash
uv run --env-file .env python scripts/run_baseline_ladder.py \
  --as-of 2026-08-14 \
  --compare-run-dir baselines/2026-08-15_baseline-v2-thinking-fix/runs
```

Live forward test (`scripts/next_day_test.py`) locks next-trading-day calls to
`predictions/<date>.json` before the open and settles them after the close:

```bash
uv run --env-file .env python -m scripts.next_day_test lock  --as-of 2026-08-17
uv run --env-file .env python -m scripts.next_day_test agent --as-of 2026-08-17 \
  --symbol TCS.NS --direction down --prob 0.42 --label agent_price
uv run --env-file .env python -m scripts.next_day_test score --as-of 2026-08-17
```

## Locked for 2026-08-18

Ten symbols locked from the 2026-08-17 close, plus the agent's own live call on TCS.NS
(price anchor, `horizon_days: 1`, post-credential-fix, `down` at 0.58 → P(up) 0.42).

| symbol | close | drift | ewma_0.3 | agent |
| --- | --- | --- | --- | --- |
| RELIANCE.NS | 1320.00 | down 0.44 | down 0.44 | — |
| TCS.NS | 2314.90 | down 0.44 | down 0.44 | **down 0.42** |
| HDFCBANK.NS | 731.35 | down 0.39 | down 0.39 | — |
| INFY.NS | 1136.10 | down 0.40 | down 0.40 | — |
| ICICIBANK.NS | 1419.60 | up 0.54 | up 0.54 | — |
| HINDUNILVR.NS | 2068.00 | down 0.41 | down 0.41 | — |
| BHARTIARTL.NS | 1975.00 | up 0.52 | up 0.52 | — |
| KOTAKBANK.NS | 395.50 | up 0.55 | up 0.55 | — |
| LT.NS | 4076.00 | down 0.46 | down 0.46 | — |
| SBIN.NS | 1065.00 | down 0.47 | down 0.47 | — |

`zero` and `naive` both sit at exactly p=0.50 by construction and are recorded as `flat`; the
scorer skips them rather than silently counting an abstention as a directional call.

**Read the result honestly when it lands.** Ten symbols on one day is roughly 10 coin flips —
7/10 correct is not skill, and 3/10 is not failure. A single day cannot separate these models;
it can only catch something being outright broken. The number that will matter is the same table
run every day for a few weeks, which is what the lock/score pair is built to accumulate.
