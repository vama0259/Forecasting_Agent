---
title: Canonical Consensus Forward Evaluation
date: 2026-08-20
status: proposed
---

# Canonical Consensus Forward Evaluation

## Problem

The system currently has two forecast truths:

- `runMultiAgentForecast()` dispatches four Round-1 agents, persists the Price agent signal as the forecast, and sends the Price agent's `/workspace/model.py` through M8.
- `runDebate()` performs Rounds 1–4 and persists a deterministic `DebateConsensus`, but this consensus is not the object scored by M8.

A one-day live consensus also cannot receive an accuracy score at creation time because its market outcome does not exist yet. The current Price-agent model backtest and final consensus forward performance are different products and must remain separately named.

## Decision

Create one production orchestration path that:

1. Runs the existing Round-1 participant execution once.
2. Reuses those signals for Rounds 2–4 without repeating Round 1.
3. Persists the final `DebateConsensus` as an immutable, canonical locked forecast.
4. Resolves that forecast only after the next completed NSE trading session.
5. Scores accumulated locked-and-resolved consensus forecasts as forward performance.

The existing `/workspace/model.py` evaluation remains available as `price_model_backtest`; it is never labelled consensus performance.

## Scope

### Included

- Production orchestration of Round 1 through deterministic Round 4.
- Immutable persistence of the final consensus.
- Idempotent next-session outcome resolution.
- Forward direction correctness and Brier scoring for resolved consensus forecasts.
- Explicit evaluation scope separating consensus forward scores from Price-model backtests.
- Tests proving the prediction cannot change after the outcome becomes known.

### Excluded

- Price ranges, conformal calibration, Cash/Futures policies, or UI work.
- Replaying historical LLM debates.
- Real-money execution.
- New prompt or quant-library work.
- Replacing the existing M8 mathematical package.

## Domain Semantics

- `as_of`: point-in-time timestamp at which the consensus was locked.
- `target_session_date`: the next NSE trading session date after `as_of`; never `as_of + 1 calendar day` blindly.
- `direction`: canonical `up|down` consensus direction.
- `probability`: probability of the chosen direction, in `[0.5, 1]`.
- `p_up`: derived as `probability` for `up`, otherwise `1 - probability`.
- Actual label: `1` when target close is strictly greater than the prior completed session close; otherwise `0`, matching M8's existing non-positive-is-down convention.
- `LOCKED`: prediction persisted before the target outcome is available.
- `RESOLVED`: a separate outcome row exists; the locked prediction remains byte-for-byte unchanged.

## Architecture

### Canonical production coordinator

Add a coordinator at the pipeline boundary rather than putting storage or market-data concerns into consensus arithmetic.

```text
runConsensusForecast
  -> execute Round 1 once
  -> runDebate(round1Signals=...)
  -> lockConsensusForecast(consensus)
  -> return consensus + separately-labelled price_model_backtest
```

`calculateConsensus()` remains pure. `runDebate()` continues to own Rounds 2–4 when precomputed Round-1 signals are supplied. The coordinator owns lifecycle, persistence, and cleanup.

All production/manual callers that claim to produce the final product forecast use this coordinator. `runMultiAgentPipeline()` may remain as a lower-level Round-1/backtest function, but its return type and logs must call the evaluation `priceModelBacktest`, not generic `evalResult` or consensus evaluation.

The existing `forecasts` row remains the run identity and legacy Price-anchor record so current foreign keys do not need replacement in this story. It is no longer a product-facing source of truth. Product forecast reads must join `locked_consensus_forecasts` and return its consensus payload; an unresolved or failed debate therefore cannot accidentally expose the earlier Price signal as the final forecast.

### Immutable storage

Add migration `007_consensus_forward_evaluation.sql` with two append-only tables.

`locked_consensus_forecasts`:

- `forecast_id UUID PRIMARY KEY REFERENCES forecasts(id)`
- `symbol TEXT NOT NULL`
- `as_of TIMESTAMPTZ NOT NULL`
- `target_session_date DATE NOT NULL`
- `horizon_days INTEGER NOT NULL CHECK (horizon_days = 1)`
- `direction TEXT NOT NULL CHECK (direction IN ('up', 'down'))`
- `probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0.5 AND 1.0)`
- `confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0)`
- `consensus_payload JSONB NOT NULL`
- `payload_sha256 TEXT NOT NULL`
- `locked_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- uniqueness on `(symbol, target_session_date)` for the initial single-daily-forecast policy

`consensus_forecast_resolutions`:

- `forecast_id UUID PRIMARY KEY REFERENCES locked_consensus_forecasts(forecast_id)`
- `prior_close DOUBLE PRECISION NOT NULL CHECK (prior_close > 0)`
- `actual_close DOUBLE PRECISION NOT NULL CHECK (actual_close > 0)`
- `actual_direction TEXT NOT NULL CHECK (actual_direction IN ('up', 'down'))`
- `actual_return DOUBLE PRECISION NOT NULL`
- `direction_correct BOOLEAN NOT NULL`
- `brier DOUBLE PRECISION NOT NULL CHECK (brier BETWEEN 0.0 AND 1.0)`
- `market_timestamp TIMESTAMPTZ NOT NULL`
- `resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `outcome_source TEXT NOT NULL`

No update path is exposed for `locked_consensus_forecasts`. Duplicate lock or resolution attempts return the existing row only when the supplied immutable values match; conflicting values raise a typed integrity error.

### Evaluation scope

Add `evaluation_scope` to `evaluation_results` with allowed values:

- `price_model_backtest`
- `consensus_forward`

The migration adds a database `CHECK` constraint for these values and a composite index on `(evaluation_scope, metric_name, created_at)`.

Existing rows migrate to `price_model_backtest`, because none were generated from locked final consensus forecasts. Consensus-forward rows are written only after resolution and use metric names `direction_correct` and `brier`. Aggregate Brier, hit rate, sample count, and calibration are computed from resolved rows; no score is emitted for a locked unresolved forecast.

## Data Flow

### Forecast creation

1. Generate a stable `forecastId` before Round 1.
2. Execute four Round-1 participants once and retain their validated signals.
3. Pass those signals into `runDebate()` for Rounds 2–4.
4. Validate the final `DebateConsensus`.
5. Determine the next NSE session through an injected `TradingCalendar` interface.
6. Canonically serialize the consensus, calculate SHA-256, and insert the locked row.
7. Return the consensus. Do not produce a consensus accuracy score.

If Round 4 succeeds but locking fails, the production run fails; an unpersisted prediction is not a product forecast.

### Outcome resolution

1. Query locked forecasts whose target session is completed and unresolved.
2. Obtain prior and target closes through an injected point-in-time `OutcomeSource`.
3. Require the returned symbol and session timestamps to match the locked target.
4. Derive actual return/direction, direction correctness, and Brier deterministically.
5. Insert one resolution row and scoped evaluation rows in one database transaction.
6. Re-running the resolver is idempotent.

Missing or incomplete market data leaves the forecast unresolved and records an operational warning; it never fabricates a result or substitutes a later session silently.

## Interfaces

Introduce small interfaces at existing boundaries:

```ts
interface TradingCalendar {
  nextSessionAfter(asOf: Date): Promise<string>; // YYYY-MM-DD
}

interface OutcomeSource {
  getDailyCloses(symbol: string, targetSessionDate: string): Promise<{
    priorClose: number;
    actualClose: number;
    marketTimestamp: Date;
    source: string;
  }>;
}
```

Repository additions perform persistence only:

- `lockConsensusForecast(...)`
- `listResolvableConsensusForecasts(...)`
- `resolveConsensusForecast(...)`
- `getConsensusForwardMetrics(...)`

No repository method accepts arbitrary updates to a locked prediction.

## Failure Handling

- Participant or debate failure: no locked forecast.
- Consensus validation failure: no locked forecast.
- Lock conflict: fail loudly with both payload hashes.
- Trading-calendar failure: no locked forecast because target identity is unknown.
- Outcome not yet published: remain unresolved.
- Wrong or duplicate market session: reject resolution.
- Database transaction failure: neither resolution nor evaluation rows commit.
- Price-model backtest failure: may be recorded separately as degraded, but cannot change or suppress a successfully validated consensus; the coordinator reports both statuses explicitly.

## Testing Strategy

Tests are written red-first and exercise real schemas/repositories where practical.

### Orchestration

- Round 1 executes exactly once.
- The same four Round-1 signals reach Rounds 2–4.
- The locked payload equals the returned Round-4 consensus, not the Price signal.
- A lock failure makes the product run fail.
- Price-model backtest status is separately named and cannot replace consensus fields.

### Persistence

- Migration creates constraints and indexes.
- Locked payload/hash cannot be modified.
- Identical retries are idempotent.
- Conflicting retries fail.
- Only one resolution can exist per locked forecast.
- Resolution plus evaluation writes are atomic.

### Resolution and comprehension gates

- Changing the locked probability while holding the outcome fixed changes Brier.
- Changing the actual close across the prior close changes direction correctness.
- Down probability is normalized to `p_up` correctly.
- Weekend/holiday targets use the trading calendar rather than calendar-day addition.
- Missing data never resolves against a later bar.
- Unresolved forecasts produce no accuracy metrics.

### Regression

- Existing debate consensus tests remain unchanged.
- Existing Python M8 tests remain unchanged.
- Existing Price-model backtests remain available under the explicit scope.
- Full Python and harness suites, lint, formatting, strict mypy, TypeScript typecheck, and Bandit pass.

## Rollout

1. Apply the migration.
2. Deploy coordinator and locking with resolution disabled; verify locked records and hashes.
3. Enable the resolver in dry-run mode and compare proposed outcomes with archived OHLCV.
4. Enable transactional resolution and scoped metrics.
5. Remove any product-facing wording that describes `price_model_backtest` as consensus performance.

No historical debate record is retroactively treated as a locked forecast. Forward evaluation begins with the first post-deployment lock.

## Acceptance Criteria

- Every product forecast returned by the production coordinator has exactly one immutable locked consensus row.
- The stored payload is the validated deterministic Round-4 consensus.
- No consensus score exists before the target session outcome.
- The next-session resolver is calendar-aware, idempotent, and point-in-time constrained.
- Consensus Brier/direction metrics are derived only from locked-and-resolved rows.
- Price-agent M8 results are labelled `price_model_backtest` everywhere.
- No ranges, execution policies, UI, or quant libraries enter this change.
