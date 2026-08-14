# M8 Read-Only Evaluation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is pre-built for `gemini-plan-implementation` — Gemini 3.7 Flash (High) implements each task from its embedded delegation prompt, a Haiku subagent validates from the embedded validator brief (escalating to Sonnet on failure). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only M8 scorer — MASE (Layer 1), Brier + calibration (Layer 2), cost-adjusted Sortino (Layer 3), and a purged walk-forward gate (Layer 4) — as pure functions over `EvalRequest`, returning `EvalResult`.

**Architecture:** Flat module-per-metric under `src/forecasting_agent/evaluation/`. `types.py` holds every Pydantic v2 model; each metric is a module-level pure function over numpy arrays. Layer 4 (`walk_forward.py` + `gate.py`) runs first and is a hard prerequisite — an `INVALID` verdict short-circuits before L1–L3 are called at all. `pipeline.evaluate()` composes them. No I/O, no clock, no persistence, no self-protection code (the read-only boundary is the Story #7 mount, decision 8).

**Tech Stack:** Python 3.12, numpy, scikit-learn>=1.7, pydantic>=2, pytest, hypothesis (dev), Ruff (120 char), mypy `--strict`, Bandit, `uv`.

**Spec:** `docs/superpowers/specs/2026-08-14-m8-evaluation-engine-design.md` (17 review rounds, cleared with two consecutive independent `APPROVED` verdicts, rounds 16–17)

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Python 3.12**, pinned via `.python-version`. All commands via `uv run` — never bare `python`/`pip`.
- **Ruff**, line length **120**, `target-version = "py312"`. Enabled rule sets include `S` (bandit), `DTZ` (timezone-aware datetimes), `T20` (no print), `TCH`, `RUF`. `S101` is globally ignored, so bare `assert` in tests is fine.
- **mypy `strict = true`** — every function, fixture, and hypothesis strategy in `src/` and `tests/evaluation/` must be fully annotated. `tests/test_smoke.py` is **out of scope** and must not be touched or fixed by this story.
- **Comments (project HARD RULE):** every file gets a one-line module-level abstract stating what the file does as a whole. Every function/method gets a one-line comment stating what it takes and what it returns — not a restatement of the body. Single line each; no multi-line docstrings, no narration of implementation. Exception: `fees.py`'s module docstring additionally carries the rate source URL and the verification date `2026-08-14` (decision 6).
- **Design:** SOLID, Clean Architecture, composition over inheritance, YAGNI-within-SOLID. Deliberate departure from the OOP-throughout rule, already argued in the spec: metrics are module-level **functions**, not classes, because they hold no state. There is deliberately **no `Metric` ABC**. The only classes are `IndianFeeSchedule`/`FeeProfile`/`RateVintage` (frozen dataclasses) and `PurgedWalkForward`. The only inheritance is `DegenerateBaselineError(Exception)` and Pydantic models from `BaseModel`.
- **Dependency rule:** nothing under `src/forecasting_agent/evaluation/` may import any first-party module outside `evaluation/`. No imports from `data_server/`, the harness, or any future sibling package. Enforced by an import-closure test in Task 8.
- **No I/O of any kind** in `evaluation/`: no file reads, no network, no logging, no `datetime.now()`, no `random_state`, no global mutable state. Same inputs must always produce the same score.
- **All datetimes are timezone-aware.** `types.py` uses Pydantic's `AwareDatetime`. Construct with `datetime.UTC`, never a naive `datetime` (Ruff `DTZ` will reject naive construction in source; tests that deliberately construct naive values for a rejection assertion must carry `# noqa: DTZ001`).
- **Exact dependency floors (decision 10):** `numpy`, `scikit-learn>=1.7`, `pydantic>=2` as runtime deps; `hypothesis` as a dev-group dep. Do **not** add `pandas`, `scipy`, or `statsmodels` as direct dependencies — nothing here imports them (`scipy` arrives transitively via scikit-learn and that is fine).
- **Never widen mypy strictness globally.** If sklearn's shipped stubs prove insufficient, the only permitted remedy is a narrowly-scoped `[[tool.mypy.overrides]]` with `module = "sklearn.*"`.
- **Only public entry point** is `forecasting_agent.evaluation.evaluate()`, re-exported alongside `EvalRequest`, `EvalResult`, and `GateVerdict` from `__init__.py`.
- **Frozen numeric constants** (verified 2026-08-14, independently re-measured by the plan author on numpy 2.5.2 / scikit-learn 1.9.0 / pydantic 2.13.4 — every value below reproduced exactly):

  | Constant | Value | Where |
  |---|---|---|
  | MASE, naive baseline, seed-7 300-point series, train 200 / test 100 | `1.0620844567408834` | Task 2 |
  | MASE, constant-zero forecast, same fixture | `0.7588485867586092` | Task 2 |
  | Brier, always-confident-and-wrong, `scale_by_half=True` | `1.0` | Task 3 |
  | Brier, perfect, `scale_by_half=True` | `0.0` | Task 3 |
  | `np.linspace(0,1,11)[3]` | `0.30000000000000004` (so confidence `0.3` → bin **2**) | Task 3 |
  | `TimeSeriesSplit(n_splits=3, gap=2)` on 20 pts, (train_first, train_last, test_first, test_last) | `(0,2,5,9)`, `(0,7,10,14)`, `(0,12,15,19)` | Task 6 |
  | `TimeSeriesSplit(n_splits=5, gap=4)` on 20 pts, train sizes | `[1, 4, 7, 10, 13]` | Task 6 |
  | `TimeSeriesSplit(n_splits=4, gap=2)` on 10 pts | raises `ValueError` before yielding any fold | Task 6 |
  | `mean(abs(diff([-1e308, 1e308, -1e308])))` | `inf` (float overflow, all elements individually finite) | Task 2 |
  | DP charge | `₹15.34` flat, GST-inclusive, delivery sells only | Task 4 |
  | Sortino worked example `period_returns[i]` | `8.466e-05` | Task 5 |

- **Fee totals on a ₹10,000 leg, brokerage 0 (Task 4 fixtures):**

  | Segment | Buy | Sell |
  |---|---|---|
  | `EQUITY_DELIVERY` | `11.87406` | `25.71406` |
  | `EQUITY_INTRADAY` | `0.67406` | `2.87406` |
  | `EQUITY_FUTURES` | `0.42774` | `5.22774` |
  | `EQUITY_OPTIONS` | `4.50434` | `19.20434` |

## Deviations from the spec, and why

Three items. Each was found by independently recomputing the spec's own pinned values rather than copying them; each is recorded here so the executing agents do not "fix" the plan back toward the spec's text.

1. **`EQUITY_DELIVERY` buy fee: the spec's Testing section says `≈₹1.87`; the correct value is `₹11.87406`.** Recomputed from decision 6's own verified rate table: STT `0.1% × 10,000 = 10.00` + stamp `0.015% × 10,000 = 1.50` + exchange `0.00307% × 10,000 = 0.307` + SEBI `0.0001% × 10,000 = 0.01` + GST `18% × (0 + 0.01 + 0.307) = 0.05706` = **`11.87406`**. The spec's own round-13 figure for the same leg at ₹1,00,000 is `₹118.7406`, which is exactly 10× `11.87406` — so the `1.87` in the Testing section is a dropped leading digit, not a different rate reading. All seven other legs in the spec's table reproduce to the last decimal. **Task 4 uses `11.87406`.**
2. **`LayerScore.beats_naive` does not exist.** Decision 2's prose describes a model "flagged `beats_naive=true, beats_zero=false`", but decision 7b's field table — which is the section that explicitly closes the schema question (H3) and enumerates every field — lists only `beats_zero`. The plan follows 7b. `beats_naive` is trivially derivable by a consumer as `value < 1.0` and adding a second stored boolean that can drift out of sync with `value` is exactly the kind of redundancy decision 3b's `invalid_folds` cut was about. **Do not add a `beats_naive` field.**
3. **No pre-2024 rate vintage values exist anywhere in the spec.** The Testing section asks for "a pre-2024 trade date selecting the older STT rate", but decision 6's table is a single vintage (verified 2026-08-14) and no round ever pinned a historical rate. Inventing one would put an unverified number in a fee schedule whose entire point is that wrong rates show up in a diff. **Resolution:** `IndianFeeSchedule` carries an ordered tuple of `RateVintage` objects and selects the latest whose `effective_from <= trade_date`; the shipped module constant contains exactly **one** vintage, `effective_from = datetime(2024, 1, 1, tzinfo=UTC)`. A trade date before the earliest vintage raises `ValueError` naming the date. The date-selection *mechanism* is tested with a test-constructed two-vintage schedule using explicit, obviously-synthetic rates; the *shipped* rate table is tested against the eight pinned real totals. Nothing is fabricated.

## Task dependency graph and parallel waves

```
Wave 1:  Task 1  (foundation: deps, types.py, errors.py, tests/evaluation/, Makefile, ci.yml)
Wave 2:  Task 2 (mase)   Task 3 (brier)   Task 4 (fees)   Task 6 (walk_forward)     [4-way parallel]
Wave 3:  Task 5 (sortino, consumes Task 4)      Task 7 (gate, consumes Tasks 2 + 6)  [2-way parallel]
Wave 4:  Task 8  (pipeline + __init__ + architecture test; consumes everything)
```

### Independence check — every pair of tasks sharing a file or interface

| Pair | Shared file? | Shared interface? | Safe to parallelize? |
|---|---|---|---|
| 2 ↔ 3 | none | none (both read `types.py`, read-only) | Yes |
| 2 ↔ 4 | none | none | Yes |
| 2 ↔ 6 | none | none | Yes |
| 3 ↔ 4 | none | `CalibrationBin` read-only vs none | Yes |
| 3 ↔ 6 | none | none | Yes |
| 4 ↔ 6 | none | none | Yes |
| 5 ↔ 7 | none | none — 5 consumes `fees.py`, 7 consumes `mase.py` + `walk_forward.py`, disjoint | Yes |
| 4 → 5 | none | 5 **calls** `IndianFeeSchedule.total_fee()` | **No — sequential**, 5 waits on 4 |
| 2 → 7 | none | 7 **calls** `mase.train_baseline()` | **No — sequential**, 7 waits on 2 |
| 6 → 7 | none | 7 **constructs** `PurgedWalkForward` | **No — sequential**, 7 waits on 6 |
| 1 → all | `types.py`, `errors.py`, `conftest.py`, `pyproject.toml` | every task imports `types.py` | **No — Task 1 must land alone first** |
| 8 → all | `__init__.py` (sole writer) | calls every module | **No — Task 8 last, alone** |

No two tasks in the same wave write the same file. `pyproject.toml`, `Makefile`, `ci.yml`, `conftest.py`, `types.py` and `errors.py` are each written by exactly one task (Task 1); `__init__.py` by exactly one task (Task 8). Every other source and test file has a single owning task.

**Constraint on Task 1 that cannot be relaxed:** `mypy src/ tests/evaluation/` hard-errors with `Cannot read file 'tests/evaluation'` until that directory exists. The `Makefile` and `ci.yml` edits must therefore land in the **same commit** that creates `tests/evaluation/` — never as an earlier standalone commit.

**Verified state of this worktree (checked on disk, not assumed from the spec):** `Makefile`'s `lint:` target is exactly `uv run ruff check .` + `uv run mypy src/`. `.github/workflows/ci.yml` has a single `lint-and-test` job with steps: checkout, install uv, set up Python, `uv sync`, Ruff, Bandit, pytest — **no mypy step, and no `harness:` job** (Story #4's sibling job has not reached this worktree). `pyproject.toml` has `dependencies = []`. `src/forecasting_agent/` contains only `__init__.py`. `tests/` contains only `__init__.py` and `test_smoke.py`. The spec's toolchain snapshot is still accurate for this worktree.

---

## Task 1: Foundation — dependencies, schema, errors, test package, toolchain

**Seam note.** This task establishes the only two seams every other task crosses: `types.py` (the validated data contract — nine `EvalRequest` fields in, eight result models out) and `errors.py` (one exception). It hides all input validation from every metric module: once a metric receives an `EvalRequest`, it may assume finiteness, unit-interval `calls`, timezone-awareness, length-matching, and a positive `capital` without re-checking any of them. That is a real boundary, not a file split — it is the single place the package stops trusting its caller, and every downstream task's test fixtures are shorter because of it. The toolchain edits ride along because mypy hard-errors on a `tests/evaluation/` path that does not yet exist, so they are physically inseparable from creating that directory.

**Files:**
- Modify: `pyproject.toml` (`dependencies`, `[dependency-groups] dev`, optionally `[[tool.mypy.overrides]]`)
- Modify: `uv.lock` (regenerated by `uv lock`)
- Modify: `Makefile` — the `lint:` target only
- Modify: `.github/workflows/ci.yml` — one added step in the existing `lint-and-test` job
- Create: `src/forecasting_agent/evaluation/__init__.py` (empty placeholder — Task 8 fills it)
- Create: `src/forecasting_agent/evaluation/types.py`
- Create: `src/forecasting_agent/evaluation/errors.py`
- Create: `tests/evaluation/__init__.py`
- Create: `tests/evaluation/conftest.py`
- Test: `tests/evaluation/test_types.py`

**Interfaces:**
- Consumes: nothing.
- Produces, from `forecasting_agent.evaluation.types`:
  - `EvalRequest(BaseModel)` — `returns: Sequence[Annotated[float, Field(allow_inf_nan=False)]]`, `forecasts: Sequence[Annotated[float, Field(allow_inf_nan=False)]]`, `calls: Sequence[Annotated[float, Field(ge=0.0, le=1.0)]]`, `timestamps: Sequence[AwareDatetime]`, `as_of: AwareDatetime`, `segment: Literal["EQUITY_DELIVERY","EQUITY_INTRADAY","EQUITY_FUTURES","EQUITY_OPTIONS"]`, `position_notional: Sequence[Annotated[float, Field(allow_inf_nan=False)]]`, `trade_side: Sequence[Literal["buy","sell","hold"]]`, `capital: Annotated[float, Field(gt=0.0, allow_inf_nan=False)]`
  - `Fold(BaseModel)` — `train_idx: Sequence[int]`, `test_idx: Sequence[int]`, `fold_number: int`
  - `FoldSkipReason(BaseModel)` — `fold_number: int`, `reason: Literal["degenerate_baseline","below_min_train_size"]`, `detail: str`
  - `CalibrationBin(BaseModel)` — `count: int`, `mean_predicted: float`, `mean_observed: float`
  - `LayerScore(BaseModel)` — `layer: Literal[1,2,3]`, `fold_number: int`, `value: float | None`, `calibration_bins: Sequence[CalibrationBin] | None = None`, `note: str | None = None`, `zero_forecast_mase: float | None = None`, `beats_zero: bool | None = None`, `annualized: bool | None = None`
  - `LayerMean(BaseModel)` — `mean: float`, `n_folds: int`
  - `GateVerdict(BaseModel)` — `status: Literal["VALID","INVALID"]`, `reasons: Sequence[str]`, `folds: Sequence[Fold]`, `skipped: Sequence[FoldSkipReason]`
  - `EvalResult(BaseModel)` — `verdict: GateVerdict`, `layers: Sequence[LayerScore]`, `layer_means: dict[Literal[1,2,3], LayerMean]`
  - from `forecasting_agent.evaluation.errors`: `DegenerateBaselineError(Exception)`
- Produces, from `tests/evaluation/conftest.py`: fixtures `seeded_returns`, `seeded_train_test`, `aware_timestamps`.

- [ ] **Step 1: Add the dependencies and regenerate the lockfile**

```bash
uv add numpy 'scikit-learn>=1.7' 'pydantic>=2'
uv add --dev hypothesis
uv lock
uv sync
```

Confirm `pyproject.toml` now reads `dependencies = ["numpy", "pydantic>=2", "scikit-learn>=1.7"]` (order as `uv` writes it) and that `hypothesis` is in `[dependency-groups] dev`. Do not add `pandas`, `scipy`, or `statsmodels`.

- [ ] **Step 2: Create the test package and its shared fixtures**

`tests/evaluation/__init__.py` — empty file (matches the existing `tests/__init__.py` convention).

`tests/evaluation/conftest.py`:

```python
"""Shared seeded synthetic fixtures for the evaluation test suite — no network, no disk, no market data."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from numpy.typing import NDArray

SEED = 7


@pytest.fixture
def seeded_returns() -> NDArray[np.float64]:
    """Takes nothing; returns the fixed 300-point seed-7 Gaussian daily return series the spec measured against."""
    return np.random.default_rng(SEED).normal(0.0, 0.01, 300)


@pytest.fixture
def seeded_train_test(seeded_returns: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Takes the seeded series; returns its (train[:200], test[200:]) split used by the MASE fixtures."""
    return seeded_returns[:200], seeded_returns[200:]


@pytest.fixture
def aware_timestamps() -> list[datetime]:
    """Takes nothing; returns 300 consecutive timezone-aware daily timestamps starting 2025-01-01T00:00Z."""
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return [start + timedelta(days=i) for i in range(300)]
```

- [ ] **Step 3: Write the failing test**

`tests/evaluation/test_types.py`:

```python
"""Tests for the evaluation package's Pydantic schema and its single exception type."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from forecasting_agent.evaluation.errors import DegenerateBaselineError
from forecasting_agent.evaluation.types import (
    CalibrationBin,
    EvalRequest,
    EvalResult,
    Fold,
    FoldSkipReason,
    GateVerdict,
    LayerMean,
    LayerScore,
)

_TS = [datetime(2025, 1, 1, tzinfo=UTC), datetime(2025, 1, 2, tzinfo=UTC), datetime(2025, 1, 3, tzinfo=UTC)]
_AS_OF = datetime(2025, 6, 1, tzinfo=UTC)


def _kwargs(**overrides: object) -> dict[str, object]:
    """Takes field overrides; returns a valid 3-period EvalRequest kwargs dict with those overrides applied."""
    base: dict[str, object] = {
        "returns": [0.01, -0.02, 0.03],
        "forecasts": [0.01, -0.01, 0.02],
        "calls": [0.6, 0.4, 0.7],
        "timestamps": _TS,
        "as_of": _AS_OF,
        "segment": "EQUITY_DELIVERY",
        "position_notional": [10_000.0, 10_000.0, 10_000.0],
        "trade_side": ["buy", "hold", "sell"],
        "capital": 1_000_000.0,
    }
    base.update(overrides)
    return base


def test_valid_request_constructs() -> None:
    request = EvalRequest(**_kwargs())  # type: ignore[arg-type]
    assert request.segment == "EQUITY_DELIVERY"
    assert request.capital == 1_000_000.0


def test_length_mismatch_names_every_offending_field_and_its_length() -> None:
    with pytest.raises(ValidationError) as excinfo:
        EvalRequest(**_kwargs(forecasts=[0.01, -0.01], calls=[0.6]))  # type: ignore[arg-type]
    message = str(excinfo.value)
    assert "length mismatch against returns (n=3)" in message
    assert "forecasts" in message
    assert "calls" in message


@pytest.mark.parametrize("bad_capital", [0.0, -1_000_000.0, float("inf"), float("nan")])
def test_capital_rejects_non_positive_and_non_finite(bad_capital: float) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(capital=bad_capital))  # type: ignore[arg-type]


@pytest.mark.parametrize("bad_calls", [[0.5, 1.4, 0.5], [0.5, -0.2, 0.5]])
def test_calls_rejects_values_outside_unit_interval(bad_calls: list[float]) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(calls=bad_calls))  # type: ignore[arg-type]


@pytest.mark.parametrize("field", ["returns", "forecasts", "position_notional"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_sequence_float_fields_reject_non_finite(field: str, bad: float) -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(**{field: [bad, 1.0, 1.0]}))  # type: ignore[arg-type]


def test_naive_datetimes_rejected_on_timestamps_and_as_of() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(as_of=datetime(2025, 6, 1)))  # type: ignore[arg-type]  # noqa: DTZ001
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(timestamps=[datetime(2025, 1, 1), *_TS[1:]]))  # type: ignore[arg-type]  # noqa: DTZ001


def test_buy_or_sell_period_requires_strictly_positive_notional() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(position_notional=[0.0, 10_000.0, 10_000.0]))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(position_notional=[-10_000.0, 10_000.0, 10_000.0]))  # type: ignore[arg-type]


def test_hold_period_may_carry_zero_notional() -> None:
    request = EvalRequest(**_kwargs(trade_side=["hold", "hold", "hold"], position_notional=[0.0, 0.0, 0.0]))  # type: ignore[arg-type]
    assert list(request.position_notional) == [0.0, 0.0, 0.0]


def test_missing_required_field_is_a_distinct_validation_path() -> None:
    kwargs = _kwargs()
    del kwargs["capital"]
    with pytest.raises(ValidationError) as excinfo:
        EvalRequest(**kwargs)  # type: ignore[arg-type]
    assert "capital" in str(excinfo.value)


def test_invalid_segment_and_trade_side_literals_rejected() -> None:
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(segment="COMMODITY"))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        EvalRequest(**_kwargs(trade_side=["short", "hold", "sell"]))  # type: ignore[arg-type]


def test_result_models_construct_with_spec_shapes() -> None:
    fold = Fold(train_idx=[0, 1, 2], test_idx=[5, 6], fold_number=1)
    skip = FoldSkipReason(fold_number=0, reason="below_min_train_size", detail="train size 1 < min_train_size 3")
    verdict = GateVerdict(status="VALID", reasons=[], folds=[fold], skipped=[skip])
    score = LayerScore(layer=1, fold_number=1, value=1.0621, zero_forecast_mase=0.7588, beats_zero=False)
    result = EvalResult(verdict=verdict, layers=[score], layer_means={1: LayerMean(mean=1.0621, n_folds=2)})
    assert result.layer_means[1].n_folds == 2
    assert result.layers[0].calibration_bins is None
    assert result.layers[0].note is None
    assert result.layers[0].annualized is None
    assert CalibrationBin(count=0, mean_predicted=0.0, mean_observed=0.0).count == 0


def test_layer_means_key_is_restricted_to_the_three_layers() -> None:
    with pytest.raises(ValidationError):
        EvalResult(
            verdict=GateVerdict(status="VALID", reasons=[], folds=[], skipped=[]),
            layers=[],
            layer_means={4: LayerMean(mean=0.0, n_folds=2)},  # type: ignore[dict-item]
        )


def test_degenerate_baseline_error_is_a_plain_exception() -> None:
    assert issubclass(DegenerateBaselineError, Exception)
    with pytest.raises(DegenerateBaselineError, match="0.0"):
        raise DegenerateBaselineError("mean(|Δy_train|) = 0.0")
```

- [ ] **Step 4: Run the test and confirm it fails for the right reason**

Run: `uv run pytest tests/evaluation/test_types.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'forecasting_agent.evaluation'`. Any other failure (e.g. `No module named 'pydantic'`) means Step 1 did not complete; fix that before continuing.

- [ ] **Step 5: Write `errors.py`**

```python
"""Exception types raised by the evaluation package."""


class DegenerateBaselineError(Exception):
    """Raised when a MASE denominator is non-finite or exactly zero, so the scale is undefined."""
```

- [ ] **Step 6: Write `types.py`**

Create `src/forecasting_agent/evaluation/__init__.py` as an empty file for now (Task 8 fills it), then `src/forecasting_agent/evaluation/types.py`. Requirements, all load-bearing:

- Field annotations exactly as listed in the **Interfaces** block above. The `allow_inf_nan=False` / `ge`/`le` bounds go on `Annotated[float, Field(...)]` wrapping the **element**, never as a bare `Field(...)` at the sequence-field level (that would constrain the sequence, not its items).
- `EvalRequest` carries a `model_validator(mode="after")` that checks every `Sequence` field's length against `len(returns)` and, if any mismatch, raises a single `ValueError` naming **every** offending field and its actual length in one message, formatted exactly:
  `f"length mismatch against returns (n={n}): {mismatched}"` where `mismatched` is a mapping/sorted listing of `field_name -> actual_length` for all mismatching fields. Pydantic wraps this as a `ValidationError`.
- A second check in the same validator (or a second `model_validator(mode="after")`): for every index `i` where `trade_side[i]` is `"buy"` or `"sell"`, require `position_notional[i] > 0.0`, otherwise raise `ValueError`. A `"hold"` period may carry any non-negative notional including `0.0`.
- Use `AwareDatetime` from `pydantic` for `timestamps` and `as_of`.
- Do **not** add a `prices` field. Do **not** add `beats_naive`. Do **not** add `EvalResult.invalid_folds`. Do **not** add `GateFailure` or `EvaluationError`.
- Every model gets the one-line comment style from Global Constraints.

- [ ] **Step 7: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_types.py -v`
Expected: all tests PASS.

- [ ] **Step 8: Make the toolchain changes — same commit, not earlier**

`Makefile`, `lint:` target — change the mypy line only:

```make
lint:
	uv run ruff check .
	uv run mypy src/ tests/evaluation/
```

`.github/workflows/ci.yml` — add one step to the existing `lint-and-test` job, immediately after the `Lint with Ruff` step and before `Security scan with Bandit`. Do **not** call `make lint` (that would re-run `ruff check .` and lose the existing step's `--output-format=github` annotations). Do **not** create a new job. Do **not** change the `on:` triggers.

```yaml
      - name: Type-check with mypy
        run: uv run mypy src/ tests/evaluation/
```

Leave `.pre-commit-config.yaml` untouched (there is no mypy hook to extend). Do not touch `tests/test_smoke.py`.

- [ ] **Step 9: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

All four must pass. `mypy` must report `Success: no issues found` — it must not report anything about `tests/test_smoke.py` (that file is outside the checked paths).

- [ ] **Step 10: Commit**

```bash
git add pyproject.toml uv.lock Makefile .github/workflows/ci.yml \
        src/forecasting_agent/evaluation/ tests/evaluation/
git commit -m "feat(evaluation): add schema, errors and runtime deps; scope mypy to tests/evaluation"
```

### Gemini delegation prompt — Task 1

```
You are implementing Task 1 of a Python 3.12 story in the git worktree at
/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6 (branch feat/issue-6-evaluation-engine).
This is the repo root. Work only inside it. Use absolute paths.

GOAL
Create the foundation of a new package `src/forecasting_agent/evaluation/`: its Pydantic v2
schema (`types.py`), its single exception (`errors.py`), the mirroring test package
`tests/evaluation/` with shared fixtures, the runtime dependencies, and two toolchain edits.

ACCEPTANCE CRITERION
The test file `tests/evaluation/test_types.py` — reproduced verbatim at the end of this prompt —
must pass unmodified. You may not edit, weaken, delete, skip, or xfail any test in it.
If a test seems wrong, stop and report rather than changing it.

STEP 1 — DEPENDENCIES
Run, in order:
  uv add numpy 'scikit-learn>=1.7' 'pydantic>=2'
  uv add --dev hypothesis
  uv lock
  uv sync
`pyproject.toml` currently has `dependencies = []`; this story is the first to add runtime deps.
Do NOT add pandas, scipy, or statsmodels — nothing here imports them (scipy arrives transitively
via scikit-learn and that is fine).

STEP 2 — FILES TO CREATE
  src/forecasting_agent/evaluation/__init__.py   (empty for now; a later task fills it)
  src/forecasting_agent/evaluation/errors.py
  src/forecasting_agent/evaluation/types.py
  tests/evaluation/__init__.py                    (empty; matches the existing tests/__init__.py)
  tests/evaluation/conftest.py                    (content given below, verbatim)
  tests/evaluation/test_types.py                  (content given below, verbatim)

`errors.py` defines exactly one class and nothing else:
    class DegenerateBaselineError(Exception)
Do NOT define GateFailure or EvaluationError — both were deliberately cut from the design.

`types.py` defines exactly these eight Pydantic v2 models and nothing else:

  EvalRequest(BaseModel):
    returns:            Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    forecasts:          Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    calls:              Sequence[Annotated[float, Field(ge=0.0, le=1.0)]]
    timestamps:         Sequence[AwareDatetime]
    as_of:              AwareDatetime
    segment:            Literal["EQUITY_DELIVERY","EQUITY_INTRADAY","EQUITY_FUTURES","EQUITY_OPTIONS"]
    position_notional:  Sequence[Annotated[float, Field(allow_inf_nan=False)]]
    trade_side:         Sequence[Literal["buy","sell","hold"]]
    capital:            Annotated[float, Field(gt=0.0, allow_inf_nan=False)]

  Fold(BaseModel):            train_idx: Sequence[int]; test_idx: Sequence[int]; fold_number: int
  FoldSkipReason(BaseModel):  fold_number: int
                              reason: Literal["degenerate_baseline","below_min_train_size"]
                              detail: str
  CalibrationBin(BaseModel):  count: int; mean_predicted: float; mean_observed: float
  LayerScore(BaseModel):      layer: Literal[1,2,3]; fold_number: int; value: float | None
                              calibration_bins: Sequence[CalibrationBin] | None = None
                              note: str | None = None
                              zero_forecast_mase: float | None = None
                              beats_zero: bool | None = None
                              annualized: bool | None = None
  LayerMean(BaseModel):       mean: float; n_folds: int
  GateVerdict(BaseModel):     status: Literal["VALID","INVALID"]; reasons: Sequence[str]
                              folds: Sequence[Fold]; skipped: Sequence[FoldSkipReason]
  EvalResult(BaseModel):      verdict: GateVerdict; layers: Sequence[LayerScore]
                              layer_means: dict[Literal[1,2,3], LayerMean]

CRITICAL DETAILS — these are exact, do not approximate:
 - The bounds (`allow_inf_nan=False`, `ge`, `le`) MUST be inside `Annotated[float, Field(...)]`
   wrapping each ELEMENT. A bare `Field(...)` at the sequence-field level constrains the sequence,
   not its items, and the tests will fail.
 - `AwareDatetime` is Pydantic's own type; import it from `pydantic`. A bare `datetime` accepts
   naive values and the tests will fail.
 - `EvalRequest` needs a `model_validator(mode="after")` that compares the length of every
   Sequence field against `len(returns)`. If ANY mismatch, raise ONE `ValueError` naming EVERY
   offending field and its actual length, formatted exactly:
       f"length mismatch against returns (n={n}): {mismatched}"
   where `mismatched` lists each mismatching field name mapped to its actual length. Naming only
   the first offender will fail the test.
 - `EvalRequest` also validates: for every index i where trade_side[i] is "buy" or "sell",
   position_notional[i] must be > 0.0, else raise ValueError. A "hold" period may carry 0.0.
 - Do NOT add a `prices` field, a `beats_naive` field, or an `EvalResult.invalid_folds` field.
   All three were deliberately cut from the design.
 - No __init__.py content beyond an empty file plus its one-line module abstract comment.

STEP 3 — TOOLCHAIN (must be in the SAME commit as tests/evaluation/, never earlier —
`mypy` hard-errors with "Cannot read file 'tests/evaluation'" if that dir doesn't exist yet)

 (a) Makefile: the `lint:` target's second line changes from
        uv run mypy src/
     to
        uv run mypy src/ tests/evaluation/
     Change nothing else in the Makefile. Do NOT widen to `tests/` — tests/test_smoke.py has a
     pre-existing missing-return-annotation error that this story does not own and must not fix.

 (b) .github/workflows/ci.yml: add exactly one step to the EXISTING `lint-and-test` job,
     immediately after the "Lint with Ruff" step and before "Security scan with Bandit":

      - name: Type-check with mypy
        run: uv run mypy src/ tests/evaluation/

     Do NOT call `make lint` from CI (it would re-run `ruff check .` and lose the existing
     step's --output-format=github annotations). Do NOT add a new job. Do NOT change `on:`.

 (c) Leave .pre-commit-config.yaml untouched. Leave tests/test_smoke.py untouched.

REPO STANDARDS (non-negotiable)
 - Python 3.12. Every command via `uv run`, never bare python/pip.
 - Ruff, line length 120, target py312. Rule sets include S, DTZ, T20, TCH, RUF. No `print`.
 - mypy strict = true. EVERY function, fixture and helper in src/ and tests/evaluation/ must be
   fully annotated, including return types (`-> None` on tests).
 - COMMENTS (project hard rule, overrides any "no comments" instinct): every file gets a ONE-LINE
   module-level abstract saying what the file does as a whole. Every function/method/model gets a
   ONE-LINE comment stating what it takes and what it returns — not a restatement of the body.
   Single line each. NO multi-line docstrings.
 - SOLID / Clean Architecture / composition over inheritance / YAGNI within SOLID.
 - `evaluation/` must not import any first-party module outside `evaluation/`. No I/O, no logging,
   no datetime.now(), no randomness, no global mutable state.
 - All datetimes timezone-aware; construct with `datetime.UTC`.

VERIFY BEFORE YOU REPORT DONE — run all four and paste the output:
  uv run ruff check . && uv run ruff format --check .
  uv run mypy src/ tests/evaluation/
  uv run bandit -r src/ -c pyproject.toml -ll
  uv run pytest tests/ -v
All four must pass. mypy must say "Success: no issues found".

BOUNDARIES — do not do any of the following:
 - Do not create mase.py, brier.py, fees.py, sortino.py, walk_forward.py, gate.py or pipeline.py.
   Later tasks own those. Task 1 is schema + errors + deps + toolchain only.
 - Do not put any content in evaluation/__init__.py beyond its one-line abstract comment.
 - Do not modify tests/test_smoke.py, .pre-commit-config.yaml, or any file under docs/.
 - Do not relax mypy strictness globally. If sklearn stubs are insufficient (unlikely in this
   task, since nothing here imports sklearn), the only permitted remedy is a narrowly-scoped
   [[tool.mypy.overrides]] with module = "sklearn.*".
 - Do not edit the test file. Do not add skip/xfail markers.
 - Do not commit. Report what you changed and leave the working tree for review.

<<< tests/evaluation/conftest.py — write this file verbatim >>>
[paste the conftest.py code block from Step 2 of Task 1]

<<< tests/evaluation/test_types.py — write this file verbatim >>>
[paste the test_types.py code block from Step 3 of Task 1]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`. Omit `model` and `effort` — the local default is already Gemini 3.7 Flash (High), and `--effort` hard-errors on Gemini models.

### Validator brief — Task 1

You are validating another agent's implementation of Task 1 in the worktree
`/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6` (branch `feat/issue-6-evaluation-engine`).
**You have no edit authority. Do not fix anything. Report findings only.**

Failing test file (the executable spec): `tests/evaluation/test_types.py`

Run each gate below from the worktree root and report **PASS/FAIL per gate** with the relevant output:

1. `uv run pytest tests/evaluation/test_types.py -v`
2. `uv run pytest tests/ -v` (no pre-existing test may have broken)
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git diff --stat` and `git status --porcelain`

Then a **correctness read** — do not stop at "tests green". Check and report on each:

- **Test integrity:** `git diff tests/evaluation/test_types.py` — was the test file modified from what the delegation prompt specified? Any added `skip`/`xfail`/`pytest.mark` decorators? Any assertion weakened or deleted? Any of these is an automatic FAIL.
- **Bounds placement:** in `types.py`, are `allow_inf_nan=False` / `ge` / `le` inside `Annotated[float, Field(...)]` wrapping the *element*, or applied at the sequence-field level? Element-level is required. A field-level `Field(...)` may still pass some tests by accident.
- **`AwareDatetime`:** are `timestamps` and `as_of` typed `AwareDatetime` (Pydantic's), not bare `datetime`?
- **Length-mismatch message:** does the `model_validator` name *every* offending field, or only the first? Confirm by reading the code, not only by the test.
- **Cut fields absent:** confirm `types.py` contains no `prices`, no `beats_naive`, no `EvalResult.invalid_folds`; confirm `errors.py` contains no `GateFailure` and no `EvaluationError`.
- **Dependencies:** does `pyproject.toml` list `numpy`, `scikit-learn>=1.7`, `pydantic>=2` under `[project] dependencies` and `hypothesis` under `[dependency-groups] dev`? Is `pandas`, `scipy`, or `statsmodels` present as a *direct* dependency? (It must not be.) Was `uv.lock` regenerated?
- **Toolchain edits:** `Makefile`'s `lint:` must be exactly `uv run ruff check .` then `uv run mypy src/ tests/evaluation/` — not `tests/`. `ci.yml` must have one added `Type-check with mypy` step inside the existing `lint-and-test` job running `uv run mypy src/ tests/evaluation/` directly (not `make lint`), with no new job and no change to the `on:` triggers.
- **Scope creep:** does `git status` show any of `mase.py`, `brier.py`, `fees.py`, `sortino.py`, `walk_forward.py`, `gate.py`, `pipeline.py`? Any content in `evaluation/__init__.py` beyond a one-line comment? Any change to `tests/test_smoke.py`, `.pre-commit-config.yaml`, or `docs/`? Any of these is a FAIL.
- **Comment style:** does every new file have a one-line module abstract, and every function/model a one-line what-it-takes/what-it-returns comment? Are there any multi-line docstrings? (Multi-line docstrings violate the project rule.)
- **mypy strictness:** was `[tool.mypy] strict` weakened, or any broad `[[tool.mypy.overrides]]` added? Only a `module = "sklearn.*"`-scoped override is permitted.

Report a final verdict of **PASS** (all gates green and the correctness read clean) or **FAIL** (with a numbered list of every defect found and the file:line for each).

---

## Shared Delegation Preamble (block **S**)

Tasks 2–7 are delegated to Gemini. Each of their prompts begins with this block verbatim. It is reproduced once here; where a task prompt says `[paste block S]`, paste the text between the fences below, unmodified.

```
You are implementing one task of a Python 3.12 story in the git worktree at
/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6 (branch feat/issue-6-evaluation-engine).
This is the repo root. Work only inside it. Use absolute paths.

The package `src/forecasting_agent/evaluation/` already exists and already contains:
  types.py   — Pydantic v2 models: EvalRequest, Fold, FoldSkipReason, CalibrationBin,
               LayerScore, LayerMean, GateVerdict, EvalResult
  errors.py  — exactly one exception: DegenerateBaselineError(Exception)
  __init__.py — empty placeholder
The test package `tests/evaluation/` exists with __init__.py and conftest.py. conftest.py provides
three fixtures you may use and must not modify:
  seeded_returns      -> NDArray[np.float64], np.random.default_rng(7).normal(0.0, 0.01, 300)
  seeded_train_test   -> tuple(seeded_returns[:200], seeded_returns[200:])
  aware_timestamps    -> list[datetime], 300 consecutive UTC days from 2025-01-01

Runtime dependencies numpy, scikit-learn>=1.7 and pydantic>=2 are already installed and locked;
hypothesis is already a dev dependency. Do NOT run `uv add` or `uv lock`. Do NOT add pandas,
scipy or statsmodels.

ACCEPTANCE CRITERION
The test file named in your task — reproduced verbatim at the end of this prompt — must pass
unmodified. You may not edit, weaken, delete, skip or xfail any test in it. If a test looks
wrong to you, STOP and report rather than changing it. Every numeric literal in it was
independently measured against numpy 2.5.2 / scikit-learn 1.9.0 / pydantic 2.13.4 and is correct.

REPO STANDARDS (non-negotiable)
 - Python 3.12. Every command via `uv run`, never bare python/pip.
 - Ruff, line length 120, target py312. Enabled rule sets include S (bandit), DTZ (timezone-aware
   datetimes), T20 (no print), TCH, RUF. No `print` anywhere.
 - mypy strict = true, and it is scoped to `src/ tests/evaluation/`. EVERY function, fixture,
   helper and hypothesis strategy you write must be fully annotated, including return types
   (`-> None` on tests). Use numpy.typing.NDArray[np.float64] for array parameters and returns.
 - COMMENTS (project hard rule, overrides any "no comments unless WHY is non-obvious" instinct):
   every file gets a ONE-LINE module-level abstract saying what the file does as a whole. Every
   function/method gets a ONE-LINE comment stating what it takes and what it returns — not a
   restatement of the body. Single line each. NO multi-line docstrings, no implementation
   narration.
 - SOLID, Clean Architecture, composition over inheritance, YAGNI within SOLID.
 - Metrics are module-level pure FUNCTIONS, not classes. There is deliberately no Metric ABC.
   Do not introduce one, and do not wrap a pure function in a class.
 - `evaluation/` must not import any first-party module outside `evaluation/`. No file or network
   I/O, no logging, no datetime.now(), no randomness, no `random_state`, no global mutable state.
   Same inputs must always produce the same output.
 - All datetimes timezone-aware; construct with `datetime.UTC`.

VERIFY BEFORE YOU REPORT DONE — run all four and paste the output:
  uv run ruff check . && uv run ruff format --check .
  uv run mypy src/ tests/evaluation/
  uv run bandit -r src/ -c pyproject.toml -ll
  uv run pytest tests/ -v
All four must pass. mypy must say "Success: no issues found".

GLOBAL BOUNDARIES
 - Create/modify ONLY the files your task's "Files" list names. Other tasks own the other modules
   and are running in parallel; touching their files will cause a merge conflict.
 - Do not modify types.py, errors.py, conftest.py, __init__.py, pyproject.toml, uv.lock, Makefile,
   .github/workflows/ci.yml, .pre-commit-config.yaml, tests/test_smoke.py, or anything under docs/.
 - Do not edit your test file. Do not add skip/xfail markers.
 - Do not relax mypy strictness globally. If sklearn stubs are insufficient, the ONLY permitted
   remedy is a narrowly-scoped [[tool.mypy.overrides]] with module = "sklearn.*" — and report it.
 - Do not commit. Report what you changed and leave the working tree for review.
```

---

## Task 2: Layer 1 — MASE

**Seam note.** `mase.py`'s interface is three functions over plain arrays: `train_baseline(y_train) -> float` (the Hyndman scale), `naive_forecast(y_train, y_test) -> array`, and `mase(y_train, y_test, forecast) -> float`. The real boundary is `train_baseline` — it is the single definition of "the scale of this fold", and `gate.py` (Task 7) calls it to decide degeneracy *before* any metric runs, while `mase()` calls it again as defense in depth. Publishing it as its own function is what lets Layer 4 detect a degenerate fold without Layer 1 being the thing that detects it — the contradiction the spec's round-3 B8 finding was about. The module hides the choice of `m=1` differencing, the `nan`-vs-zero degeneracy split, and the naive-forecast construction from every caller.

**Files:**
- Create: `src/forecasting_agent/evaluation/mase.py`
- Test: `tests/evaluation/test_mase.py`

**Interfaces:**
- Consumes: `forecasting_agent.evaluation.errors.DegenerateBaselineError` (Task 1). Fixtures `seeded_returns`, `seeded_train_test`.
- Produces:
  - `train_baseline(y_train: NDArray[np.float64]) -> float` — `mean(abs(diff(y_train)))`, **unguarded**: returns `nan` / `inf` / `0.0` as-is so the caller can classify. Never raises.
  - `naive_forecast(y_train: NDArray[np.float64], y_test: NDArray[np.float64]) -> NDArray[np.float64]` — last-observed-carried-forward: element `0` is `y_train[-1]`, element `i>0` is `y_test[i-1]`.
  - `mase(y_train: NDArray[np.float64], y_test: NDArray[np.float64], forecast: NDArray[np.float64]) -> float` — raises `DegenerateBaselineError` if the baseline is non-finite or exactly `0.0`.
  - `zero_forecast_mase(y_train: NDArray[np.float64], y_test: NDArray[np.float64]) -> float` — `mase` against an all-zero forecast.

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_mase.py`:

```python
"""Tests for Layer 1 — MASE with a Hyndman train-fold denominator, plus the zero-forecast baseline."""

import math

import numpy as np
import pytest
from hypothesis import assume, given
from hypothesis import strategies as st
from numpy.typing import NDArray

from forecasting_agent.evaluation.errors import DegenerateBaselineError
from forecasting_agent.evaluation.mase import mase, naive_forecast, train_baseline, zero_forecast_mase

NAIVE_ON_SEEDED = 1.0620844567408834
ZERO_ON_SEEDED = 0.7588485867586092


def test_perfect_forecast_scores_zero(seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]]) -> None:
    train, test = seeded_train_test
    assert mase(train, test, test.copy()) == 0.0


def test_naive_forecast_on_seeded_series_matches_measured_value(
    seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]],
) -> None:
    train, test = seeded_train_test
    assert mase(train, test, naive_forecast(train, test)) == pytest.approx(NAIVE_ON_SEEDED, rel=1e-12)


def test_naive_scores_exactly_one_on_a_matched_scale_series() -> None:
    train = np.array([0.0, 1.0, 0.0, 1.0, 0.0, 1.0])
    test = np.array([1.0, 0.0, 1.0, 0.0])
    assert mase(train, test, naive_forecast(train, test)) == pytest.approx(1.0, rel=1e-12)


def test_zero_forecast_is_reported_and_beats_naive_on_the_seeded_series(
    seeded_train_test: tuple[NDArray[np.float64], NDArray[np.float64]],
) -> None:
    train, test = seeded_train_test
    zero = zero_forecast_mase(train, test)
    naive = mase(train, test, naive_forecast(train, test))
    assert zero == pytest.approx(ZERO_ON_SEEDED, rel=1e-12)
    assert zero < naive


def test_naive_forecast_is_last_observed_carried_forward() -> None:
    train = np.array([1.0, 2.0, 3.0])
    test = np.array([10.0, 20.0, 30.0])
    assert np.array_equal(naive_forecast(train, test), np.array([3.0, 10.0, 20.0]))


def test_train_baseline_is_unguarded_and_reports_each_degenerate_shape() -> None:
    assert train_baseline(np.array([1.0, 2.0, 4.0])) == pytest.approx(1.5)
    assert train_baseline(np.array([5.0, 5.0, 5.0, 5.0])) == 0.0
    assert math.isnan(train_baseline(np.array([5.0])))
    assert math.isinf(train_baseline(np.array([-1e308, 1e308, -1e308])))


def test_mase_raises_on_constant_train_fold() -> None:
    train = np.array([5.0, 5.0, 5.0, 5.0, 5.0, 5.0])
    test = np.array([1.0, 2.0])
    with pytest.raises(DegenerateBaselineError):
        mase(train, test, np.array([1.0, 2.0]))


def test_mase_raises_on_non_finite_baseline_from_float_overflow() -> None:
    train = np.array([-1e308, 1e308, -1e308])
    test = np.array([1.0, 2.0])
    with pytest.raises(DegenerateBaselineError):
        mase(train, test, np.array([1.0, 2.0]))


def test_mase_raises_on_single_element_train_fold() -> None:
    with pytest.raises(DegenerateBaselineError):
        mase(np.array([5.0]), np.array([1.0, 2.0]), np.array([1.0, 2.0]))


@given(
    train=st.lists(st.floats(-100.0, 100.0, allow_nan=False, allow_infinity=False), min_size=3, max_size=60),
    test=st.lists(st.floats(-100.0, 100.0, allow_nan=False, allow_infinity=False), min_size=1, max_size=30),
)
def test_mase_is_non_negative(train: list[float], test: list[float]) -> None:
    train_arr = np.asarray(train, dtype=np.float64)
    assume(len(train_arr) >= 3)
    baseline = train_baseline(train_arr)
    assume(math.isfinite(baseline) and baseline > 0.0)
    test_arr = np.asarray(test, dtype=np.float64)
    assert mase(train_arr, test_arr, naive_forecast(train_arr, test_arr)) >= 0.0
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_mase.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.mase'`.

- [ ] **Step 3: Implement `mase.py`**

Requirements:
- `m = 1` first differencing on daily returns. Do **not** implement a seasonal-naive baseline.
- `train_baseline` returns `float(np.mean(np.abs(np.diff(y_train))))` with **no guard** — a 1-element input yields `nan` (numpy will warn on the empty-slice mean; suppress with `np.errstate`/`warnings.catch_warnings` scoped to that one call rather than globally, and do not let the warning escape as an error). Never raises.
- `mase` computes `d = train_baseline(y_train)` and raises `DegenerateBaselineError` if `not math.isfinite(d) or d == 0.0`. **Both arms are required** — `math.isfinite(0.0)` is `True`, so the `isfinite` arm alone misses the constant-train case, and `d == 0.0` alone misses the `nan`/`inf` case. Include the offending value in the message.
- `mase` returns `float(np.mean(np.abs(y_test - forecast)) / d)`.
- `zero_forecast_mase(y_train, y_test)` is `mase(y_train, y_test, np.zeros_like(y_test))`.
- This guard is **defense in depth** — `gate.py` (a later task) is the primary detector. It should never fire when called through the pipeline. Do not remove it, and do not import anything from `gate.py`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_mase.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/mase.py tests/evaluation/test_mase.py
git commit -m "feat(evaluation): add Layer 1 MASE with train-fold denominator and zero-forecast baseline"
```

### Gemini delegation prompt — Task 2

```
[paste block S]

YOUR TASK — Task 2: Layer 1, MASE.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/mase.py
  tests/evaluation/test_mase.py

Write tests/evaluation/test_mase.py verbatim from the block at the end of this prompt, then
implement mase.py so it passes.

mase.py exposes exactly four module-level functions:

  train_baseline(y_train: NDArray[np.float64]) -> float
      Hyndman's MASE scale: float(np.mean(np.abs(np.diff(y_train)))) with m=1 first differencing.
      UNGUARDED — it must return nan / inf / 0.0 as-is and NEVER raise, because the Layer 4 gate
      (a later task, do not write it) calls this to CLASSIFY a fold's degeneracy before any metric
      runs. A 1-element input makes numpy emit a mean-of-empty-slice RuntimeWarning; suppress it
      with a narrowly-scoped np.errstate / warnings.catch_warnings around that one call, never
      with a global warnings filter.

  naive_forecast(y_train: NDArray[np.float64], y_test: NDArray[np.float64]) -> NDArray[np.float64]
      Last-observed-carried-forward. Element 0 is y_train[-1]; element i>0 is y_test[i-1].
      Same length as y_test.

  mase(y_train, y_test, forecast) -> float
      d = train_baseline(y_train)
      if (not math.isfinite(d)) or d == 0.0:  raise DegenerateBaselineError(<message naming d>)
      return float(np.mean(np.abs(y_test - forecast)) / d)

  zero_forecast_mase(y_train, y_test) -> float
      mase(y_train, y_test, np.zeros_like(y_test))

CRITICAL DETAILS — exact, do not approximate:
 - BOTH guard arms are required and neither is sufficient alone. math.isfinite(0.0) is True, so
   the isfinite arm alone lets a CONSTANT training series through (its mean|diff| is exactly 0.0)
   and you get a division by zero. Conversely `d == 0.0` alone misses nan (1-element fold) and inf
   (float overflow: mean(abs(diff([-1e308, 1e308, -1e308]))) is inf, measured). Write
   `if not math.isfinite(d) or d == 0.0:`.
 - m = 1 (plain first difference). Do NOT implement a seasonal-naive baseline — these are daily
   returns, already-differenced prices, and a seasonal denominator would inflate the scale and
   flatter every model.
 - The denominator is computed on the TRAIN fold, never the test fold. Computing it on the test
   fold would make the naive baseline score exactly 1.0, which is what the GitHub issue wrongly
   claims; the correct measured value on the seeded fixture is 1.0620844567408834, and the test
   asserts that. Do not "fix" the code to make it 1.0.
 - mase()'s guard is DEFENSE IN DEPTH only. A later task's gate.py is the primary detector and
   filters degenerate folds before Layer 1 ever sees them. Keep the guard; do not import gate.py.
 - The four numeric literals in the test (0.0 perfect, 1.0620844567408834 naive, 0.7588485867586092
   zero-forecast, 1.0 on the matched-scale constructed series) were all measured. They are correct.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch brier.py, fees.py, sortino.py, walk_forward.py, gate.py or pipeline.py.
 - Do not add a Metric class or ABC. Four module-level functions, nothing else.
 - Do not import sklearn in this module — MASE is plain numpy.

<<< tests/evaluation/test_mase.py — write this file verbatim >>>
[paste the test_mase.py code block from Step 1 of Task 2]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 2

Validating Task 2 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_mase.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_mase.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `src/forecasting_agent/evaluation/mase.py` and `tests/evaluation/test_mase.py` may appear

Correctness read — report on each, do not stop at "tests green":

- **Test integrity:** was `test_mase.py` altered from the delegated content? Any `skip`/`xfail`? Any tolerance widened (the two `pytest.approx(..., rel=1e-12)` calls must still be `rel=1e-12`)? Automatic FAIL if so.
- **Both guard arms present:** read `mase()`. Is the condition `not math.isfinite(d) or d == 0.0`? A single-arm guard (`isfinite` only, or `== 0.0` only) is a FAIL even if tests pass — check for it explicitly.
- **`train_baseline` never raises:** confirm it has no `raise` and no guard. The gate depends on getting `nan`/`inf`/`0.0` back to classify. If the implementer moved the guard into `train_baseline`, that is a FAIL.
- **Warning suppression scope:** if `np.errstate`/`warnings` handling was added, is it scoped to the one `np.mean` call, or applied module-globally / via a `filterwarnings` config? A global filter is a FAIL.
- **Denominator source:** confirm the divisor comes from `y_train`, never `y_test`.
- **`m=1`:** confirm plain `np.diff` with no seasonal lag parameter.
- **No forbidden structure:** no `Metric` class/ABC, no sklearn import in `mase.py`, no import of `gate.py` or any other sibling metric module, no I/O, no logging, no `print`.
- **Comment style:** one-line module abstract present; one-line what-it-takes/what-it-returns comment on each of the four functions; no multi-line docstrings.
- **Annotations:** every function and every test annotated, arrays typed `NDArray[np.float64]`.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 3: Layer 2 — Brier score and calibration bins

**Seam note.** `brier.py`'s interface is two functions and one constant: `brier(calls, returns) -> float`, `calibration_bins(calls, returns) -> list[CalibrationBin]`, and `BIN_EDGES`. It hides two decisions no caller should have to know: that the binary label is derived as `returns[i] > 0.0` (a zero return is labelled not-bull), and that `sklearn.metrics.brier_score_loss` is called with `scale_by_half=True` — a literal, never `"auto"`, because `"auto"`'s resolution logic is itself version-dependent and a silent flip doubles every historical calibration number. It is a real boundary because the sklearn version-drift risk is entirely contained behind it: exactly one call site in the codebase passes that flag, and one test asserts the literal.

**Files:**
- Create: `src/forecasting_agent/evaluation/brier.py`
- Test: `tests/evaluation/test_brier.py`

**Interfaces:**
- Consumes: `forecasting_agent.evaluation.types.CalibrationBin` (Task 1).
- Produces:
  - `BIN_EDGES: NDArray[np.float64]` — `np.linspace(0.0, 1.0, 11)`
  - `bull_labels(returns: NDArray[np.float64]) -> NDArray[np.int_]` — `1` where `returns > 0.0`, else `0`
  - `brier(calls: NDArray[np.float64], returns: NDArray[np.float64]) -> float`
  - `calibration_bins(calls: NDArray[np.float64], returns: NDArray[np.float64]) -> list[CalibrationBin]` — always exactly 10 entries, index-aligned to bin `0..9`, empty bins reported with `count=0`

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_brier.py`:

```python
"""Tests for Layer 2 — Brier score under the scale_by_half=True convention, plus 10-bin calibration."""

from unittest.mock import patch

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.brier import BIN_EDGES, brier, bull_labels, calibration_bins


def test_perfect_predictions_score_zero() -> None:
    calls = np.array([0.0, 1.0, 0.0, 1.0])
    returns = np.array([-0.01, 0.01, -0.02, 0.02])
    assert brier(calls, returns) == pytest.approx(0.0)


def test_always_confident_and_wrong_scores_one() -> None:
    calls = np.array([1.0, 0.0, 1.0, 0.0])
    returns = np.array([-0.01, 0.01, -0.02, 0.02])
    assert brier(calls, returns) == pytest.approx(1.0)


def test_scale_by_half_true_is_passed_as_a_literal() -> None:
    calls = np.array([1.0, 0.0])
    returns = np.array([-0.01, 0.01])
    with patch("forecasting_agent.evaluation.brier.brier_score_loss", return_value=1.0) as spy:
        brier(calls, returns)
    assert spy.call_count == 1
    assert spy.call_args.kwargs["scale_by_half"] is True


def test_zero_return_is_labelled_not_bull() -> None:
    assert list(bull_labels(np.array([0.01, 0.0, -0.01]))) == [1, 0, 0]


def test_bin_edges_are_eleven_points_over_the_unit_interval() -> None:
    assert len(BIN_EDGES) == 11
    assert BIN_EDGES[0] == 0.0
    assert BIN_EDGES[-1] == 1.0
    assert BIN_EDGES[3] == 0.30000000000000004


def test_all_ten_bins_reported_including_empty_ones() -> None:
    calls = np.array([0.05, 0.05, 0.95, 0.95])
    returns = np.array([-0.01, 0.01, 0.01, 0.01])
    bins = calibration_bins(calls, returns)
    assert len(bins) == 10
    assert [b.count for b in bins] == [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]
    assert bins[0].mean_predicted == pytest.approx(0.05)
    assert bins[0].mean_observed == pytest.approx(0.5)
    assert bins[9].mean_predicted == pytest.approx(0.95)
    assert bins[9].mean_observed == pytest.approx(1.0)


def test_empty_bins_report_zero_not_nan() -> None:
    bins = calibration_bins(np.array([0.05, 0.95]), np.array([0.01, 0.01]))
    for index in range(1, 9):
        assert bins[index].count == 0
        assert bins[index].mean_predicted == 0.0
        assert bins[index].mean_observed == 0.0


def test_boundary_confidence_lands_in_the_measured_bin_not_the_naive_one() -> None:
    bins = calibration_bins(np.array([0.3]), np.array([0.01]))
    assert bins[2].count == 1
    assert bins[3].count == 0


def test_unit_endpoints_do_not_overflow_the_bin_range() -> None:
    bins = calibration_bins(np.array([0.0, 1.0]), np.array([-0.01, 0.01]))
    assert bins[0].count == 1
    assert bins[9].count == 1


@given(
    st.lists(
        st.tuples(st.floats(0.0, 1.0, allow_nan=False), st.floats(-1.0, 1.0, allow_nan=False, allow_infinity=False)),
        min_size=1,
        max_size=50,
    )
)
def test_brier_is_within_the_unit_interval(pairs: list[tuple[float, float]]) -> None:
    calls = np.asarray([p[0] for p in pairs], dtype=np.float64)
    returns = np.asarray([p[1] for p in pairs], dtype=np.float64)
    assert 0.0 <= brier(calls, returns) <= 1.0
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_brier.py -v`
Expected: `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.brier'`.

- [ ] **Step 3: Implement `brier.py`**

Requirements:
- Import as `from sklearn.metrics import brier_score_loss` at module level, so the test's `patch("forecasting_agent.evaluation.brier.brier_score_loss")` resolves. Do not import it inside the function body.
- `brier()` calls `brier_score_loss(bull_labels(returns), calls, scale_by_half=True)` — the literal `True`, never `"auto"`, never `False`, never omitted. Return `float(...)`.
- `bull_labels(returns)` is `(returns > 0.0).astype(int)` — a zero return is `0`.
- `BIN_EDGES = np.linspace(0.0, 1.0, 11)`. Bin assignment is `np.digitize(calls, BIN_EDGES[1:-1])`, which maps `[0,1]` onto indices `0..9` with no overflow at either endpoint. Do **not** use `sklearn.calibration.calibration_curve` — it silently drops empty bins and attaches no bin index, which cannot satisfy the all-10-bins requirement.
- `calibration_bins()` returns exactly 10 `CalibrationBin` objects, index `i` describing bin `i`. Empty bins get `count=0, mean_predicted=0.0, mean_observed=0.0` — never `nan`, never omitted. Compute the two means only over the bin's members; guard the division so an empty bin does not emit a `nan` or a warning.
- No mutation of the inputs.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_brier.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

If sklearn's stubs make `brier_score_loss` untyped under strict mypy, add a `[[tool.mypy.overrides]]` scoped to `module = "sklearn.*"` **only** — and report that you did.

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/brier.py tests/evaluation/test_brier.py
git commit -m "feat(evaluation): add Layer 2 Brier score and 10-bin calibration table"
```

### Gemini delegation prompt — Task 3

```
[paste block S]

YOUR TASK — Task 3: Layer 2, Brier score and calibration bins.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/brier.py
  tests/evaluation/test_brier.py

Write tests/evaluation/test_brier.py verbatim from the block at the end of this prompt, then
implement brier.py so it passes.

brier.py exposes exactly one module constant and three module-level functions:

  BIN_EDGES: NDArray[np.float64] = np.linspace(0.0, 1.0, 11)

  bull_labels(returns: NDArray[np.float64]) -> NDArray[np.int_]
      (returns > 0.0).astype(int). A return of exactly 0.0 is labelled 0 (not-bull).

  brier(calls: NDArray[np.float64], returns: NDArray[np.float64]) -> float
      float(brier_score_loss(bull_labels(returns), calls, scale_by_half=True))

  calibration_bins(calls, returns) -> list[CalibrationBin]
      Exactly 10 entries, index-aligned to bin 0..9. Import CalibrationBin from
      forecasting_agent.evaluation.types.

CRITICAL DETAILS — exact, do not approximate:
 - Import brier_score_loss at MODULE level: `from sklearn.metrics import brier_score_loss`.
   A test patches "forecasting_agent.evaluation.brier.brier_score_loss", which only resolves if
   the name is bound at module scope. Do not import it inside the function body.
 - Pass `scale_by_half=True` — the LITERAL True. Not "auto", not False, not omitted. Measured on
   scikit-learn 1.9.0 with always-confident-and-wrong predictions: True -> 1.0, "auto" -> 1.0,
   False -> 2.0. "auto" happens to agree today but its resolution logic is version-dependent, and
   a future sklearn flipping it would silently double every calibration number in the eval
   history. A test asserts the literal value passed, so nothing else will pass.
 - Bin assignment is np.digitize(calls, BIN_EDGES[1:-1]) — slice off the first and last edge.
   Measured: this maps 0.0 -> bin 0 and 1.0 -> bin 9 with no overflow at either endpoint.
 - Do NOT use sklearn.calibration.calibration_curve. Measured: with n_bins=10 on a 4-point input
   it returns only 2 entries with NO bin index attached, so empty bins are dropped and
   unidentifiable. The requirement is all 10 bins always reported.
 - Empty bins get count=0, mean_predicted=0.0, mean_observed=0.0 — NEVER nan, never omitted.
   A dropped bin makes a model look better calibrated than it is. Guard the mean division so an
   empty bin emits neither nan nor a numpy warning.
 - np.linspace(0, 1, 11) does not produce exact decimals: BIN_EDGES[3] is 0.30000000000000004,
   measured, so a confidence of exactly 0.3 falls in bin 2, NOT bin 3. A test asserts bin 2. This
   is correct and deterministic — do not "fix" it by rounding the edges or by using a different
   binning scheme.
 - Do not mutate the input arrays.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch mase.py, fees.py, sortino.py, walk_forward.py, gate.py or pipeline.py.
 - Do not add a Metric class or ABC.
 - If sklearn's stubs make brier_score_loss untyped under strict mypy, the ONLY permitted remedy
   is adding [[tool.mypy.overrides]] with module = "sklearn.*" to pyproject.toml — and you must
   report that you did it. Do not use a blanket `# type: ignore` on the import, and do not weaken
   [tool.mypy] strict.

<<< tests/evaluation/test_brier.py — write this file verbatim >>>
[paste the test_brier.py code block from Step 1 of Task 3]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 3

Validating Task 3 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_brier.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_brier.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `brier.py`, `test_brier.py`, and possibly `pyproject.toml` (sklearn override only) may appear

Correctness read:

- **Test integrity:** was `test_brier.py` altered? Any `skip`/`xfail`? Was `test_scale_by_half_true_is_passed_as_a_literal` weakened (e.g. asserting only that the kwarg exists rather than `is True`)? Automatic FAIL.
- **The literal:** read the actual call. Is it `scale_by_half=True`? A value of `"auto"` or `False`, or omitting the kwarg, is a FAIL — `"auto"` would pass the value-based tests today and break on a future sklearn bump, which is precisely the risk this task exists to close.
- **Module-level import:** is `brier_score_loss` imported at module scope (so the patch target resolves), not inside the function?
- **No `calibration_curve`:** confirm `sklearn.calibration.calibration_curve` appears nowhere.
- **All 10 bins, unconditionally:** read `calibration_bins`. Does it always build exactly 10 entries, or does it iterate over observed bins and pad? Confirm empty bins yield `0.0`/`0.0`, not `nan`, and that no `RuntimeWarning` is emitted (check test output for `RuntimeWarning: invalid value encountered`).
- **Bin edges untouched:** confirm `BIN_EDGES` is `np.linspace(0.0, 1.0, 11)` with no rounding applied, and that digitize slices `[1:-1]`.
- **Label rule:** confirm `returns == 0.0` maps to label `0`, not `1` and not dropped.
- **Input purity:** confirm neither function mutates `calls` or `returns`.
- **mypy override scope:** if `pyproject.toml` changed, is the addition exactly a `[[tool.mypy.overrides]]` with `module = "sklearn.*"`? Any broader override, any change to `[tool.mypy] strict`, or any blanket `# type: ignore` is a FAIL.
- **Comment style / annotations:** one-line module abstract; one-line comment per function; no multi-line docstrings; every function and test annotated.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 4: Indian cost schedule

**Seam note.** `fees.py`'s interface is a single method: `IndianFeeSchedule.total_fee(position_notional, trade_side, segment, trade_date) -> float`. Everything else — four per-segment rate profiles, buy/sell asymmetry, the GST base composition, the flat DP charge, and rate-vintage selection by trade date — is hidden behind it. That is a genuinely deep module: one four-argument call replaces the most intricate arithmetic in the story, and `sortino.py` (Task 5) never needs to know which segment charges on premium or which charge is flat. It is the right boundary because rates are the thing that changes annually, and this is the only place a rate change has to land.

**Files:**
- Create: `src/forecasting_agent/evaluation/fees.py`
- Test: `tests/evaluation/test_fees.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `Segment = Literal["EQUITY_DELIVERY","EQUITY_INTRADAY","EQUITY_FUTURES","EQUITY_OPTIONS"]`
  - `TradeSide = Literal["buy","sell","hold"]`
  - `DP_CHARGE_INR: float = 15.34`, `GST_RATE: float = 0.18`, `SEBI_TURNOVER_RATE: float = 1e-6`
  - `@dataclass(frozen=True) FeeProfile` — `stt_buy: float`, `stt_sell: float`, `exchange_txn: float`, `stamp_duty: float`, `dp_applies: bool`
  - `@dataclass(frozen=True) RateVintage` — `effective_from: datetime`, `profiles: Mapping[Segment, FeeProfile]`
  - `INDIAN_RATE_VINTAGES: tuple[RateVintage, ...]` — one entry, `effective_from = datetime(2024, 1, 1, tzinfo=UTC)`
  - `@dataclass(frozen=True) IndianFeeSchedule` — `brokerage: float = 0.0`, `vintages: tuple[RateVintage, ...] = INDIAN_RATE_VINTAGES`; method `total_fee(self, position_notional: float, trade_side: TradeSide, segment: Segment, trade_date: datetime) -> float`

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_fees.py`:

```python
"""Tests for the Indian cost schedule — per-segment rates, buy/sell asymmetry, DP flat charge, GST base."""

from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.fees import (
    DP_CHARGE_INR,
    GST_RATE,
    INDIAN_RATE_VINTAGES,
    FeeProfile,
    IndianFeeSchedule,
    RateVintage,
)

TRADE_DATE = datetime(2026, 8, 14, tzinfo=UTC)
LEG = 10_000.0

EXPECTED = {
    ("EQUITY_DELIVERY", "buy"): 11.87406,
    ("EQUITY_DELIVERY", "sell"): 25.71406,
    ("EQUITY_INTRADAY", "buy"): 0.67406,
    ("EQUITY_INTRADAY", "sell"): 2.87406,
    ("EQUITY_FUTURES", "buy"): 0.42774,
    ("EQUITY_FUTURES", "sell"): 5.22774,
    ("EQUITY_OPTIONS", "buy"): 4.50434,
    ("EQUITY_OPTIONS", "sell"): 19.20434,
}


@pytest.fixture
def schedule() -> IndianFeeSchedule:
    """Takes nothing; returns the shipped zero-brokerage Indian fee schedule."""
    return IndianFeeSchedule()


@pytest.mark.parametrize(("key", "expected"), sorted(EXPECTED.items()))
def test_each_segment_and_side_matches_its_pinned_total(
    schedule: IndianFeeSchedule, key: tuple[str, str], expected: float
) -> None:
    segment, side = key
    assert schedule.total_fee(LEG, side, segment, TRADE_DATE) == pytest.approx(expected, abs=1e-9)  # type: ignore[arg-type]


def test_hold_period_is_free_regardless_of_notional(schedule: IndianFeeSchedule) -> None:
    assert schedule.total_fee(1_000_000.0, "hold", "EQUITY_DELIVERY", TRADE_DATE) == 0.0
    assert schedule.total_fee(0.0, "hold", "EQUITY_DELIVERY", TRADE_DATE) == 0.0


def test_dp_charge_applies_only_to_delivery_sells(schedule: IndianFeeSchedule) -> None:
    delivery_sell = schedule.total_fee(LEG, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    delivery_buy = schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE)
    intraday_sell = schedule.total_fee(LEG, "sell", "EQUITY_INTRADAY", TRADE_DATE)
    assert delivery_sell - DP_CHARGE_INR == pytest.approx(10.37406, abs=1e-9)
    assert delivery_buy < DP_CHARGE_INR
    assert intraday_sell < DP_CHARGE_INR


def test_dp_charge_is_excluded_from_the_gst_base(schedule: IndianFeeSchedule) -> None:
    delivery_sell = schedule.total_fee(LEG, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    if_dp_were_taxed = delivery_sell + GST_RATE * DP_CHARGE_INR
    assert delivery_sell == pytest.approx(25.71406, abs=1e-9)
    assert if_dp_were_taxed == pytest.approx(28.47526, abs=1e-9)
    assert delivery_sell != pytest.approx(if_dp_were_taxed, abs=1e-6)


def test_gst_is_charged_on_brokerage_plus_sebi_plus_exchange_only() -> None:
    zero = IndianFeeSchedule(brokerage=0.0)
    paid = IndianFeeSchedule(brokerage=20.0)
    assert paid.total_fee(LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE) - zero.total_fee(
        LEG, "buy", "EQUITY_DELIVERY", TRADE_DATE
    ) == pytest.approx(20.0 * (1.0 + GST_RATE), abs=1e-9)


def test_dp_flat_charge_dominates_at_small_notional(schedule: IndianFeeSchedule) -> None:
    small = schedule.total_fee(1_000.0, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    large = schedule.total_fee(1_000_000.0, "sell", "EQUITY_DELIVERY", TRADE_DATE)
    assert small / 1_000.0 > 0.015
    assert large / 1_000_000.0 < 0.0015
    assert small / 1_000.0 > large / 1_000_000.0


def test_rate_vintage_is_selected_by_trade_date_not_by_now() -> None:
    old_profile = FeeProfile(stt_buy=0.0, stt_sell=0.0, exchange_txn=0.0, stamp_duty=0.0, dp_applies=False)
    new_profile = FeeProfile(stt_buy=0.5, stt_sell=0.5, exchange_txn=0.0, stamp_duty=0.0, dp_applies=False)
    profiles_old = {s: old_profile for s in ("EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS")}
    profiles_new = {s: new_profile for s in ("EQUITY_DELIVERY", "EQUITY_INTRADAY", "EQUITY_FUTURES", "EQUITY_OPTIONS")}
    schedule = IndianFeeSchedule(
        brokerage=0.0,
        vintages=(
            RateVintage(effective_from=datetime(2020, 1, 1, tzinfo=UTC), profiles=profiles_old),  # type: ignore[arg-type]
            RateVintage(effective_from=datetime(2025, 1, 1, tzinfo=UTC), profiles=profiles_new),  # type: ignore[arg-type]
        ),
    )
    assert schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(2023, 6, 1, tzinfo=UTC)) == pytest.approx(0.0)
    assert schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(2026, 6, 1, tzinfo=UTC)) == pytest.approx(5000.0)


def test_trade_date_before_the_earliest_vintage_raises(schedule: IndianFeeSchedule) -> None:
    with pytest.raises(ValueError, match="1999"):
        schedule.total_fee(LEG, "buy", "EQUITY_DELIVERY", datetime(1999, 1, 1, tzinfo=UTC))


def test_shipped_schedule_has_exactly_one_vintage_effective_2024() -> None:
    assert len(INDIAN_RATE_VINTAGES) == 1
    assert INDIAN_RATE_VINTAGES[0].effective_from == datetime(2024, 1, 1, tzinfo=UTC)
    assert set(INDIAN_RATE_VINTAGES[0].profiles) == {
        "EQUITY_DELIVERY",
        "EQUITY_INTRADAY",
        "EQUITY_FUTURES",
        "EQUITY_OPTIONS",
    }


def test_profiles_are_frozen(schedule: IndianFeeSchedule) -> None:
    profile = INDIAN_RATE_VINTAGES[0].profiles["EQUITY_DELIVERY"]
    with pytest.raises(Exception, match="rozen"):
        profile.stt_buy = 0.9  # type: ignore[misc]


@given(
    notional=st.floats(1e3, 1e8, allow_nan=False, allow_infinity=False),
    multiplier=st.floats(10.0, 1e3, allow_nan=False, allow_infinity=False),
)
def test_delivery_sell_cost_fraction_strictly_decreases_in_notional(notional: float, multiplier: float) -> None:
    schedule = IndianFeeSchedule()
    larger = notional * multiplier
    assume_bounded = 1e3 <= notional <= 1e9 and 1e3 <= larger <= 1e9
    if not assume_bounded:
        return
    small_fraction = schedule.total_fee(notional, "sell", "EQUITY_DELIVERY", TRADE_DATE) / notional
    large_fraction = schedule.total_fee(larger, "sell", "EQUITY_DELIVERY", TRADE_DATE) / larger
    assert small_fraction > large_fraction
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_fees.py -v`
Expected: `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.fees'`.

- [ ] **Step 3: Implement `fees.py`**

Module abstract plus, in the module docstring, the rate source (broker charges page) and the verification date `2026-08-14`. Rates as literals in this file — never a config file.

The single shipped vintage, `effective_from = datetime(2024, 1, 1, tzinfo=UTC)`:

| Segment | `stt_buy` | `stt_sell` | `exchange_txn` | `stamp_duty` (buy only) | `dp_applies` |
|---|---|---|---|---|---|
| `EQUITY_DELIVERY` | `0.001` | `0.001` | `0.0000307` | `0.00015` | `True` |
| `EQUITY_INTRADAY` | `0.0` | `0.00025` | `0.0000307` | `0.00003` | `False` |
| `EQUITY_FUTURES` | `0.0` | `0.0005` | `0.0000183` | `0.00002` | `False` |
| `EQUITY_OPTIONS` | `0.0` | `0.0015` | `0.0003553` | `0.00003` | `False` |

`total_fee(position_notional, trade_side, segment, trade_date)`:

```
if trade_side == "hold": return 0.0
profile = <latest vintage with effective_from <= trade_date>[segment]   # ValueError naming trade_date if none
stt      = position_notional * (profile.stt_buy if trade_side == "buy" else profile.stt_sell)
exchange = position_notional * profile.exchange_txn
sebi     = position_notional * SEBI_TURNOVER_RATE
stamp    = position_notional * profile.stamp_duty if trade_side == "buy" else 0.0
gst      = GST_RATE * (self.brokerage + sebi + exchange)
dp       = DP_CHARGE_INR if (profile.dp_applies and trade_side == "sell") else 0.0
return self.brokerage + stt + exchange + sebi + stamp + gst + dp
```

`DP_CHARGE_INR = 15.34` is ₹3.5 CDSL + ₹9.5 broker + ₹2.34 GST — **already GST-inclusive**, so it is outside the GST base. Applying the schedule's own 18% on top would double-count a tax already paid.

For `EQUITY_OPTIONS`, `position_notional` is the **premium**, not the underlying notional — that is what the options STT, exchange and DP rates are levied on. `total_fee` does not need to know this; it multiplies whatever base it is given. The caller contract is stated in `types.py`'s field comment and in Story #9.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_fees.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/fees.py tests/evaluation/test_fees.py
git commit -m "feat(evaluation): add verified Indian per-segment fee schedule with flat DP charge"
```

### Gemini delegation prompt — Task 4

```
[paste block S]

YOUR TASK — Task 4: the Indian cost schedule.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/fees.py
  tests/evaluation/test_fees.py

Write tests/evaluation/test_fees.py verbatim from the block at the end of this prompt, then
implement fees.py so it passes.

fees.py exposes:

  Segment   = Literal["EQUITY_DELIVERY","EQUITY_INTRADAY","EQUITY_FUTURES","EQUITY_OPTIONS"]
  TradeSide = Literal["buy","sell","hold"]

  DP_CHARGE_INR: float      = 15.34
  GST_RATE: float           = 0.18
  SEBI_TURNOVER_RATE: float = 1e-6      # Rs 10 per crore

  @dataclass(frozen=True) FeeProfile:
      stt_buy: float; stt_sell: float; exchange_txn: float; stamp_duty: float; dp_applies: bool

  @dataclass(frozen=True) RateVintage:
      effective_from: datetime; profiles: Mapping[Segment, FeeProfile]

  INDIAN_RATE_VINTAGES: tuple[RateVintage, ...]
      EXACTLY ONE entry, effective_from = datetime(2024, 1, 1, tzinfo=UTC), carrying all four
      segment profiles from the table below.

  @dataclass(frozen=True) IndianFeeSchedule:
      brokerage: float = 0.0
      vintages: tuple[RateVintage, ...] = INDIAN_RATE_VINTAGES
      def total_fee(self, position_notional: float, trade_side: TradeSide,
                    segment: Segment, trade_date: datetime) -> float

RATE TABLE for the single shipped vintage — these are verified against the live published broker
schedule as of 2026-08-14. Put the source (broker charges page) and that verification date in the
MODULE DOCSTRING. Rates are literals in this file, never a config file — a wrong rate must show up
in a code diff and a test.

  segment            stt_buy   stt_sell   exchange_txn   stamp_duty(buy only)   dp_applies
  EQUITY_DELIVERY    0.001     0.001      0.0000307      0.00015                True
  EQUITY_INTRADAY    0.0       0.00025    0.0000307      0.00003                False
  EQUITY_FUTURES     0.0       0.0005     0.0000183      0.00002                False
  EQUITY_OPTIONS     0.0       0.0015     0.0003553      0.00003                False

total_fee ALGORITHM — implement exactly this:

  if trade_side == "hold": return 0.0            # a hold contributes zero fees, any notional
  profile = <the LATEST vintage whose effective_from <= trade_date>.profiles[segment]
            if no vintage qualifies -> raise ValueError naming trade_date
  stt      = position_notional * (profile.stt_buy if trade_side == "buy" else profile.stt_sell)
  exchange = position_notional * profile.exchange_txn
  sebi     = position_notional * SEBI_TURNOVER_RATE
  stamp    = position_notional * profile.stamp_duty if trade_side == "buy" else 0.0
  gst      = GST_RATE * (self.brokerage + sebi + exchange)
  dp       = DP_CHARGE_INR if (profile.dp_applies and trade_side == "sell") else 0.0
  return self.brokerage + stt + exchange + sebi + stamp + gst + dp

CRITICAL DETAILS — exact, do not approximate:
 - GST base is EXACTLY (brokerage + SEBI + exchange). NOT STT, NOT stamp duty, and above all NOT
   the DP charge. DP_CHARGE_INR = 15.34 already decomposes as Rs 3.5 CDSL + Rs 9.5 broker +
   Rs 2.34 GST — it is GST-INCLUSIVE, so taxing it again double-counts a tax already paid.
   A test asserts the total differs from the would-be-taxed total.
 - Stamp duty is BUY-ONLY for every segment. STT is asymmetric per the table (delivery charges it
   on BOTH sides; the other three charge it on sell only). A single symmetric rate cannot express
   this — that is why FeeProfile has separate stt_buy and stt_sell.
 - The DP charge is FLAT (a rupee amount), not a percentage, and fires once per delivery SELL,
   independent of notional. On a Rs 10,000 delivery round trip it is ~0.15%, larger than every
   percentage charge combined. This is the schedule's headline finding — do not model it as a rate.
 - Rate selection is by TRADE DATE, never by "now". Do not call datetime.now() anywhere. A 2023
   backtest priced at 2026 rates is a wrong number that looks right.
 - All datetimes are timezone-aware. Comparing a naive effective_from to an aware trade_date
   raises TypeError. Construct with datetime(..., tzinfo=UTC).
 - The eight expected leg totals on a Rs 10,000 leg with brokerage 0 were independently recomputed
   and are correct as written in the test:
     DELIVERY  buy 11.87406   sell 25.71406
     INTRADAY  buy  0.67406   sell  2.87406
     FUTURES   buy  0.42774   sell  5.22774
     OPTIONS   buy  4.50434   sell 19.20434
   NOTE: the upstream design spec's Testing section states the delivery BUY leg as "~Rs 1.87".
   That is a typo (a dropped leading digit) — the spec's own Rs 1,00,000 figure for the same leg
   is Rs 118.7406, exactly 10x 11.87406. Use 11.87406. Do not "correct" it back to 1.87.
 - For EQUITY_OPTIONS, position_notional is the PREMIUM, not the underlying notional — that is
   what the options STT / exchange rates are levied on. total_fee does not need to know this; it
   multiplies whatever base it is handed. Just note it in the method's one-line comment.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch mase.py, brier.py, sortino.py, walk_forward.py, gate.py or pipeline.py.
 - Do not import numpy or sklearn here — this is plain Python arithmetic on scalars.
 - Do not read rates from a file, an env var, or a config. Literals in fees.py only.
 - Do not invent a second (pre-2024) rate vintage. No historical rate values are verified anywhere,
   and fabricating one would put an unchecked number in the schedule. Ship exactly one vintage and
   raise ValueError for earlier trade dates. The date-selection mechanism is tested with a
   test-constructed synthetic two-vintage schedule, which is why `vintages` is a constructor field.

<<< tests/evaluation/test_fees.py — write this file verbatim >>>
[paste the test_fees.py code block from Step 1 of Task 4]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 4

Validating Task 4 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_fees.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_fees.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `fees.py` and `test_fees.py` may appear

Correctness read — the rate table is the point of this task, so read it against the brief:

- **Test integrity:** was `test_fees.py` altered? Any `skip`/`xfail`? Any `pytest.approx` tolerance widened beyond `abs=1e-9`? Automatic FAIL.
- **Rate table, value by value:** compare `fees.py`'s literals against this table and report any mismatch —
  `EQUITY_DELIVERY` `0.001 / 0.001 / 0.0000307 / 0.00015 / True`;
  `EQUITY_INTRADAY` `0.0 / 0.00025 / 0.0000307 / 0.00003 / False`;
  `EQUITY_FUTURES` `0.0 / 0.0005 / 0.0000183 / 0.00002 / False`;
  `EQUITY_OPTIONS` `0.0 / 0.0015 / 0.0003553 / 0.00003 / False`.
  Also `DP_CHARGE_INR == 15.34`, `GST_RATE == 0.18`, `SEBI_TURNOVER_RATE == 1e-6`.
- **GST base:** read the `gst` line. Is it `GST_RATE * (brokerage + sebi + exchange)` and nothing else? If STT, stamp, or DP appears in that sum, FAIL.
- **DP application:** fires only when `profile.dp_applies and trade_side == "sell"`, as a flat addend, never multiplied by notional?
- **Stamp duty:** buy-only for all four segments?
- **Hold:** returns exactly `0.0` and short-circuits before any rate lookup?
- **No clock:** confirm `datetime.now()`, `date.today()`, `time.time()` appear nowhere in `fees.py`. Rate selection must key off `trade_date` only.
- **Vintage count:** confirm `INDIAN_RATE_VINTAGES` has exactly one entry and that no fabricated pre-2024 rate values were invented. If a second vintage with invented historical rates was added, that is a FAIL — report the values it invented.
- **Frozen:** are `FeeProfile`, `RateVintage` and `IndianFeeSchedule` all `@dataclass(frozen=True)`?
- **Timezone:** is `effective_from` constructed with `tzinfo=UTC`? Any naive datetime is a FAIL (it would raise `TypeError` on comparison with an aware `trade_date`).
- **No stray deps:** confirm `fees.py` imports neither numpy nor sklearn, and reads no file/env/config.
- **Module docstring:** does it carry the rate source and the verification date `2026-08-14`? (This is the one file permitted extra module-docstring content.)
- **Comment style / annotations:** one-line comment per function/method/dataclass; no multi-line docstrings beyond the module docstring; everything annotated.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 5: Layer 3 — cost-adjusted Sortino  *(depends on Task 4)*

**Seam note.** `sortino.py` splits at the one place the story's two hardest ideas meet: `cost_adjusted_period_returns(...)` turns asset returns + notional + sides + fees into a single exposure-weighted, capital-denominated series, and `sortino(period_returns) -> SortinoResult` turns that series into a number, a flag, and an optional note. The seam is that array: everything about fees, exposure weighting and segments lives on one side of it, everything about downside deviation and annualization on the other, and each side is testable against hand-computed values without the other. `SortinoResult` exists so the "no losing period" case can be `None` with a reason rather than `inf` — a fold with no losses is a sample-size statement, not an infinitely good strategy.

**Files:**
- Create: `src/forecasting_agent/evaluation/sortino.py`
- Test: `tests/evaluation/test_sortino.py`

**Interfaces:**
- Consumes: `forecasting_agent.evaluation.fees.IndianFeeSchedule`, `Segment`, `TradeSide` (Task 4).
- Produces:
  - `TRADING_DAYS_PER_YEAR: int = 252`, `MIN_OBS_FOR_ANNUALIZATION: int = 20`
  - `class SortinoResult(NamedTuple)` — `value: float | None`, `annualized: bool`, `note: str | None`
  - `cost_adjusted_period_returns(returns, position_notional, trade_side, timestamps, segment, capital, schedule) -> NDArray[np.float64]`
  - `downside_deviation(period_returns: NDArray[np.float64]) -> float`
  - `sortino(period_returns: NDArray[np.float64]) -> SortinoResult`

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_sortino.py`:

```python
"""Tests for Layer 3 — exposure-weighted cost-adjusted period returns and the Sortino ratio."""

from datetime import UTC, datetime

import numpy as np
import pytest

from forecasting_agent.evaluation.fees import IndianFeeSchedule
from forecasting_agent.evaluation.sortino import (
    MIN_OBS_FOR_ANNUALIZATION,
    TRADING_DAYS_PER_YEAR,
    cost_adjusted_period_returns,
    downside_deviation,
    sortino,
)

TRADE_DATE = datetime(2026, 8, 14, tzinfo=UTC)


def test_constants_are_the_named_module_values() -> None:
    assert TRADING_DAYS_PER_YEAR == 252
    assert MIN_OBS_FOR_ANNUALIZATION == 20


def test_exposure_weighted_period_return_matches_the_worked_example() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([0.01]),
        position_notional=np.array([10_000.0]),
        trade_side=["sell"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == pytest.approx(8.466e-05, rel=1e-6)
    assert period[0] != pytest.approx(0.00998466, rel=1e-6)


def test_flat_hold_period_absorbs_no_market_loss() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([-0.05]),
        position_notional=np.array([0.0]),
        trade_side=["hold"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == 0.0


def test_hold_with_carried_notional_is_still_exposure_weighted_but_free() -> None:
    period = cost_adjusted_period_returns(
        returns=np.array([-0.05]),
        position_notional=np.array([10_000.0]),
        trade_side=["hold"],
        timestamps=[TRADE_DATE],
        segment="EQUITY_DELIVERY",
        capital=1_000_000.0,
        schedule=IndianFeeSchedule(),
    )
    assert period[0] == pytest.approx(-0.0005, rel=1e-12)


def test_downside_deviation_divides_by_n_not_by_the_negative_count() -> None:
    series = np.array([0.02, -0.01, 0.03, -0.02, 0.01])
    assert downside_deviation(series) == pytest.approx(0.01, rel=1e-12)
    assert downside_deviation(series) != pytest.approx(0.015811388300841896, rel=1e-9)


def test_sortino_on_a_hand_computed_short_series_is_not_annualized() -> None:
    series = np.array([0.02, -0.01, 0.03, -0.02, 0.01])
    result = sortino(series)
    assert result.annualized is False
    assert result.note is None
    assert result.value == pytest.approx(0.6, rel=1e-12)


def test_sortino_annualizes_at_or_above_the_observation_floor() -> None:
    series = np.tile(np.array([0.02, -0.01, 0.03, -0.02, 0.01]), 4)
    assert len(series) == 20
    result = sortino(series)
    assert result.annualized is True
    assert result.value == pytest.approx(0.6 * np.sqrt(TRADING_DAYS_PER_YEAR), rel=1e-12)


def test_annualized_form_agrees_with_the_bare_sqrt_scaled_ratio() -> None:
    series = np.tile(np.array([0.02, -0.01, 0.03, -0.02, 0.01]), 4)
    numerator_denominator = (float(series.mean()) * TRADING_DAYS_PER_YEAR) / (
        downside_deviation(series) * float(np.sqrt(TRADING_DAYS_PER_YEAR))
    )
    value = sortino(series).value
    assert value is not None
    assert value == pytest.approx(numerator_denominator, rel=1e-12)


def test_no_losing_period_reports_none_with_a_note_not_infinity() -> None:
    result = sortino(np.array([0.01, 0.02, 0.0, 0.03]))
    assert result.value is None
    assert result.note == "no_downside_observations"
    assert result.annualized is False


def test_all_zero_series_reports_no_downside_observations() -> None:
    result = sortino(np.zeros(30))
    assert result.value is None
    assert result.note == "no_downside_observations"


def test_target_return_is_zero_so_small_positive_returns_are_not_downside() -> None:
    assert downside_deviation(np.array([0.0001, 0.0002, 0.0003])) == 0.0


def test_fees_reduce_the_period_return_relative_to_a_free_schedule() -> None:
    kwargs = {
        "returns": np.array([0.01]),
        "position_notional": np.array([10_000.0]),
        "trade_side": ["sell"],
        "timestamps": [TRADE_DATE],
        "segment": "EQUITY_DELIVERY",
        "capital": 1_000_000.0,
    }
    charged = cost_adjusted_period_returns(schedule=IndianFeeSchedule(), **kwargs)  # type: ignore[arg-type]
    brokered = cost_adjusted_period_returns(schedule=IndianFeeSchedule(brokerage=50.0), **kwargs)  # type: ignore[arg-type]
    assert brokered[0] < charged[0]
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_sortino.py -v`
Expected: `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.sortino'`.

- [ ] **Step 3: Implement `sortino.py`**

```
period_returns[i] = returns[i] * position_notional[i] / capital
                  - schedule.total_fee(position_notional[i], trade_side[i], segment, timestamps[i]) / capital
```

- **Both terms share the same base** (a return on total capital). `returns[i]` is an **asset** return — a return on `position_notional[i]`, not on `capital` — so it must be exposure-weighted before the capital-denominated fee is subtracted. Dropping the weighting understates the fee's drag by exactly `capital / position_notional` (100× in the worked example) and erases the whole point of the DP charge.
- A `hold` period contributes zero fee but is **still** exposure-weighted; a flat (`position_notional == 0`) strategy must not absorb the market's loss.
- `downside_deviation(x) = sqrt(mean(minimum(x, 0.0) ** 2))` — MAR is **zero**, and the divisor is **N**, not the count of negative observations. Dividing by the negative count rewards a strategy for having few, huge losses.
- `sortino(x)`: if `downside_deviation(x) == 0.0`, return `SortinoResult(None, False, "no_downside_observations")`. Otherwise, if `len(x) >= MIN_OBS_FOR_ANNUALIZATION`, return `SortinoResult((mean(x) * 252) / (dd * sqrt(252)), True, None)`; else `SortinoResult(mean(x) / dd, False, None)`.
- `TRADING_DAYS_PER_YEAR = 252` and `MIN_OBS_FOR_ANNUALIZATION = 20` are named module constants — both are judgment calls, revisable against real fold-size distributions, and must not be inlined as magic numbers.
- Never return `inf`. Never return `nan`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_sortino.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/sortino.py tests/evaluation/test_sortino.py
git commit -m "feat(evaluation): add Layer 3 cost-adjusted Sortino with exposure-weighted returns"
```

### Gemini delegation prompt — Task 5

```
[paste block S]

ADDITIONAL CONTEXT FOR THIS TASK: src/forecasting_agent/evaluation/fees.py already exists and
provides `IndianFeeSchedule` (a frozen dataclass, `brokerage: float = 0.0`) with the method
`total_fee(position_notional: float, trade_side: TradeSide, segment: Segment,
trade_date: datetime) -> float`, plus the Literal aliases `Segment` and `TradeSide`. Read that
file before you start. Do NOT modify it.

YOUR TASK — Task 5: Layer 3, cost-adjusted Sortino.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/sortino.py
  tests/evaluation/test_sortino.py

Write tests/evaluation/test_sortino.py verbatim from the block at the end of this prompt, then
implement sortino.py so it passes.

sortino.py exposes:

  TRADING_DAYS_PER_YEAR: int      = 252
  MIN_OBS_FOR_ANNUALIZATION: int  = 20

  class SortinoResult(NamedTuple):
      value: float | None
      annualized: bool
      note: str | None

  cost_adjusted_period_returns(
      returns: NDArray[np.float64],
      position_notional: NDArray[np.float64],
      trade_side: Sequence[TradeSide],
      timestamps: Sequence[datetime],
      segment: Segment,
      capital: float,
      schedule: IndianFeeSchedule,
  ) -> NDArray[np.float64]
      # keyword-callable with exactly these names — the tests call it by keyword

  downside_deviation(period_returns: NDArray[np.float64]) -> float
  sortino(period_returns: NDArray[np.float64]) -> SortinoResult

THE FORMULA — implement exactly this, element by element:

  period_returns[i] = returns[i] * position_notional[i] / capital
                    - schedule.total_fee(position_notional[i], trade_side[i], segment,
                                         timestamps[i]) / capital

CRITICAL DETAILS — exact, do not approximate:
 - `returns[i]` is an ASSET return — a return on position_notional[i], NOT on capital. It MUST be
   exposure-weighted by position_notional[i]/capital before the capital-denominated fee is
   subtracted, so both terms share the same base. Measured on the worked example
   (capital=1,000,000, position_notional=10,000, returns=0.01, delivery sell, DP=Rs 15.34):
     correct   -> 8.466e-05    (fee drag ~15.3% of the return)
     unweighted-> 0.00998466   (fee drag ~0.15% of the return)
   The unweighted form understates the fee's drag by exactly capital/position_notional (100x here)
   and erases the entire point of the flat DP charge. A test asserts the correct value AND asserts
   the result is NOT the unweighted one.
 - A "hold" period contributes ZERO fee (total_fee already returns 0.0 for "hold") but is STILL
   exposure-weighted. If position_notional[i] is 0.0, period_returns[i] must be 0.0 even on a -5%
   market day — a flat strategy has no downside exposure and must not absorb the market's loss.
   Do NOT special-case "hold" by skipping the weighting.
 - downside_deviation(x) = float(np.sqrt(np.mean(np.minimum(x, 0.0) ** 2)))
   Target return (MAR) is ZERO, not a risk-free rate — the deficiency being measured is loss, and
   mixing in a T-bill rate would make the number depend on a rate curve we don't ingest.
   The divisor is N (np.mean over the whole array), NOT the count of negative observations.
   Dividing by the negative count is a common implementation that REWARDS a strategy for having
   few, huge losses. Measured on [0.02,-0.01,0.03,-0.02,0.01]: divide-by-N gives 0.01,
   divide-by-negative-count gives 0.015811388300841896. A test asserts 0.01 and asserts it is not
   the other.
 - sortino(x):
     dd = downside_deviation(x)
     if dd == 0.0:  return SortinoResult(None, False, "no_downside_observations")
     if len(x) >= MIN_OBS_FOR_ANNUALIZATION:
         return SortinoResult((float(x.mean()) * TRADING_DAYS_PER_YEAR)
                              / (dd * float(np.sqrt(TRADING_DAYS_PER_YEAR))), True, None)
     return SortinoResult(float(x.mean()) / dd, False, None)
   Zero downside deviation gives mathematically-correct-but-useless `inf`. NEVER return inf and
   NEVER return nan — a fold with no losses is a sample-size statement, not an infinitely good
   strategy, and inf propagates into any mean. Return None with the note instead.
 - Use the numerator/denominator annualization form above (mean*252 over dd*sqrt(252)), not a bare
   ratio * sqrt(252). They are numerically equivalent here (verified to 1e-16) and a test asserts
   the agreement, but the stated form is the one that generalizes if the two factors ever differ.
 - 252 and 20 are NAMED MODULE CONSTANTS. Both are judgment calls to be revisited against real
   fold sizes. Do not inline them as magic numbers.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch mase.py, brier.py, fees.py, walk_forward.py, gate.py or pipeline.py.
 - Do NOT modify fees.py — read it, import from it, leave it alone. It is already reviewed.
 - Do not add a Metric class or ABC.
 - Do not import sklearn here — this is numpy plus fees.py.

<<< tests/evaluation/test_sortino.py — write this file verbatim >>>
[paste the test_sortino.py code block from Step 1 of Task 5]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 5

Validating Task 5 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_sortino.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_sortino.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `sortino.py` and `test_sortino.py` may appear. **`fees.py` must be unchanged** — if `git diff src/forecasting_agent/evaluation/fees.py` is non-empty, that is an automatic FAIL.

Correctness read:

- **Test integrity:** was `test_sortino.py` altered? Any `skip`/`xfail`? Tolerances widened? Automatic FAIL.
- **Exposure weighting present:** read the formula. Is `returns[i]` multiplied by `position_notional[i] / capital`? An implementation that subtracts the fee from a bare `returns[i]` is a FAIL even if the worked-example test happens to pass — check the code, not just the number.
- **Hold not special-cased:** confirm the weighting is applied uniformly and that `"hold"` is not branched around. The zero-fee behaviour must come from `total_fee` returning `0.0`, not from a skip in this module.
- **Downside divisor:** confirm `np.mean` over the full array (divide by N), not `np.sum(...) / negative_count`.
- **MAR is zero:** confirm no risk-free rate, no configurable target, appears anywhere.
- **No `inf` / no `nan`:** confirm the `dd == 0.0` branch returns `SortinoResult(None, False, "no_downside_observations")` and that no code path can divide by zero or emit `nan`. Check the test output for any `RuntimeWarning`.
- **Note string exact:** the literal must be `"no_downside_observations"` — not a variant spelling.
- **Constants named:** confirm `252` and `20` appear as `TRADING_DAYS_PER_YEAR` / `MIN_OBS_FOR_ANNUALIZATION` and are not inlined at their use sites.
- **Annualization form:** confirm `(mean * 252) / (dd * sqrt(252))`, not `(mean / dd) * sqrt(252)`.
- **Annualization threshold:** confirm `>= MIN_OBS_FOR_ANNUALIZATION` (inclusive at 20), and that `annualized=False` when below.
- **No stray deps / purity:** no sklearn import, no I/O, no logging, no clock, no mutation of input arrays.
- **Comment style / annotations:** one-line module abstract, one-line comment per function; no multi-line docstrings; `SortinoResult` fields annotated.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 6: Layer 4a — the purged walk-forward splitter

**Seam note.** `PurgedWalkForward` is a thin decorator over `sklearn.model_selection.TimeSeriesSplit` that exposes the same `split(X)` shape while owning four parameter invariants its wrapper target does not: `min_train_size >= 3`, `n_splits >= 2`, `horizon >= 1`, and `gap >= horizon`. It is a class rather than a function because it holds split configuration and nothing else. The boundary matters because it is where the "embargo is equivalent to purging at horizon=1" claim is enforced — a multi-bar label raises `NotImplementedError` naming the missing purge rather than silently under-purging, which is the one failure ADR-012 exists to prevent. All four checks live in `__init__` so the direct-construction path (which the tests use) is bounded identically to the `evaluate()` path.

**Files:**
- Create: `src/forecasting_agent/evaluation/walk_forward.py`
- Test: `tests/evaluation/test_walk_forward.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `class PurgedWalkForward` — `__init__(self, *, n_splits: int = 5, gap: int | None = None, horizon: int = 1, min_train_size: int = 3) -> None`; attributes `n_splits`, `gap` (resolved `int`), `horizon`, `min_train_size`; `split(self, X: NDArray[np.float64]) -> Iterator[tuple[NDArray[np.intp], NDArray[np.intp]]]`; `get_n_splits(self) -> int`
  - `split()` performs **no** per-fold filtering — `min_train_size` is stored for `gate.py` (Task 7) to apply. `split()` lets `TimeSeriesSplit`'s `ValueError` propagate unchanged.

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_walk_forward.py`:

```python
"""Tests for Layer 4a — the PurgedWalkForward splitter wrapping TimeSeriesSplit with an embargo."""

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def test_fold_boundaries_match_the_measured_timeseriessplit_output() -> None:
    folds = list(PurgedWalkForward(n_splits=3, gap=2, horizon=1).split(np.zeros(20)))
    assert len(folds) == 3
    boundaries = [(int(t[0]), int(t[-1]), int(v[0]), int(v[-1])) for t, v in folds]
    assert boundaries == [(0, 2, 5, 9), (0, 7, 10, 14), (0, 12, 15, 19)]


def test_train_sizes_match_the_measured_degenerate_configuration() -> None:
    folds = list(PurgedWalkForward(n_splits=5, gap=4, horizon=1).split(np.zeros(20)))
    assert [len(t) for t, _ in folds] == [1, 4, 7, 10, 13]


def test_split_does_not_filter_below_min_train_size_folds() -> None:
    splitter = PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3)
    assert len(list(splitter.split(np.zeros(20)))) == 5
    assert splitter.min_train_size == 3


def test_gap_defaults_to_horizon_not_to_zero() -> None:
    assert PurgedWalkForward().gap == 1
    assert PurgedWalkForward(horizon=1, gap=4).gap == 4


def test_gap_below_horizon_raises_value_error() -> None:
    with pytest.raises(ValueError, match="gap"):
        PurgedWalkForward(n_splits=3, gap=0, horizon=1)


def test_multi_bar_horizon_raises_not_implemented_naming_purging() -> None:
    with pytest.raises(NotImplementedError, match="purg"):
        PurgedWalkForward(n_splits=3, gap=5, horizon=2)


@pytest.mark.parametrize(
    ("kwargs", "token"),
    [
        ({"min_train_size": 2}, "min_train_size"),
        ({"min_train_size": 0}, "min_train_size"),
        ({"n_splits": 1}, "n_splits"),
        ({"horizon": 0}, "horizon"),
    ],
)
def test_constructor_bounds_are_enforced_with_the_offending_parameter_named(kwargs: dict[str, int], token: str) -> None:
    with pytest.raises((ValueError, NotImplementedError), match=token):
        PurgedWalkForward(**kwargs)


def test_infeasible_configuration_propagates_value_error_from_the_splitter() -> None:
    with pytest.raises(ValueError):
        list(PurgedWalkForward(n_splits=4, gap=2, horizon=1).split(np.zeros(10)))


def test_get_n_splits_reports_the_configured_count() -> None:
    assert PurgedWalkForward(n_splits=3).get_n_splits() == 3


def test_embargo_leaves_at_least_horizon_bars_between_train_and_test() -> None:
    for train, test in PurgedWalkForward(n_splits=3, gap=2, horizon=1).split(np.zeros(20)):
        assert int(test[0]) - int(train[-1]) > 1


@given(
    n_splits=st.integers(2, 5),
    gap=st.integers(1, 4),
    n_samples=st.integers(60, 200),
)
def test_train_indices_are_always_strictly_before_test_indices(n_splits: int, gap: int, n_samples: int) -> None:
    for train, test in PurgedWalkForward(n_splits=n_splits, gap=gap, horizon=1).split(np.zeros(n_samples)):
        assert int(train.max()) < int(test.min())
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_walk_forward.py -v`
Expected: `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.walk_forward'`.

- [ ] **Step 3: Implement `walk_forward.py`**

- `__init__` resolves `effective_gap = horizon if gap is None else gap` **in the body** — a parameter default cannot reference a sibling parameter, since Python evaluates defaults at definition time. Store the resolved value on `self.gap`.
- Validate, in `__init__`, in this order, each raising `ValueError` naming the offending parameter and its value: `min_train_size >= 3`, `n_splits >= 2`, `horizon >= 1`, then `effective_gap >= horizon`. Then, if `horizon > 1`, raise `NotImplementedError` mentioning **purging** by name.
- `min_train_size >= 3` is the floor because a size-2 train array yields exactly one diff, and a mean of one diff is not a baseline scale. The floor and the default deliberately coincide.
- `split(X)` yields directly from `TimeSeriesSplit(n_splits=self.n_splits, gap=self.gap).split(X)`. It performs **no** filtering — `min_train_size` is stored for `gate.py` to apply, so that per-fold rejection is recorded in a `GateVerdict` rather than silently swallowed here. Let `TimeSeriesSplit`'s `ValueError` propagate unchanged; `gate.py` catches it.
- The wrapper delivers the **embargo** half of López de Prado's scheme, not purging. At `horizon=1` a `gap >= 1` embargo is exactly equivalent to purging, which is why multi-bar horizons raise instead.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_walk_forward.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/walk_forward.py tests/evaluation/test_walk_forward.py
git commit -m "feat(evaluation): add PurgedWalkForward splitter with embargo and bounded parameters"
```

### Gemini delegation prompt — Task 6

```
[paste block S]

YOUR TASK — Task 6: Layer 4a, the purged walk-forward splitter.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/walk_forward.py
  tests/evaluation/test_walk_forward.py

Write tests/evaluation/test_walk_forward.py verbatim from the block at the end of this prompt,
then implement walk_forward.py so it passes.

walk_forward.py exposes exactly one class:

  class PurgedWalkForward:
      def __init__(self, *, n_splits: int = 5, gap: int | None = None,
                   horizon: int = 1, min_train_size: int = 3) -> None
      def split(self, X: NDArray[np.float64]
                ) -> Iterator[tuple[NDArray[np.intp], NDArray[np.intp]]]
      def get_n_splits(self) -> int

  Public attributes after construction: n_splits, gap (a resolved int), horizon, min_train_size.

__init__ MUST:
 1. Resolve the gap sentinel IN THE BODY:  effective_gap = horizon if gap is None else gap
    A parameter default CANNOT reference a sibling parameter — Python evaluates defaults at
    function-definition time, before any call supplies `horizon`. `None` is a sentinel, not a
    real default. Store the resolved int on self.gap.
 2. Validate, in this order, each raising ValueError NAMING the offending parameter and its value:
      min_train_size >= 3
      n_splits       >= 2
      horizon        >= 1
      effective_gap  >= horizon
 3. Then, if horizon > 1, raise NotImplementedError whose message contains the word "purging".

split(X) MUST:
  yield from TimeSeriesSplit(n_splits=self.n_splits, gap=self.gap).split(X)
  and do NOTHING ELSE. In particular:
   - It performs NO per-fold filtering. min_train_size is STORED, not applied here. A later task's
     gate.py applies it, so a rejected fold is RECORDED in a GateVerdict rather than silently
     swallowed. A test asserts split() still yields all 5 folds for a config where one is
     below min_train_size.
   - It lets TimeSeriesSplit's own ValueError propagate unchanged. Measured: n_splits=4, gap=2 on
     10 points raises "Too many splits..." on the FIRST next(), before yielding any fold. Do not
     catch it, do not wrap it, do not return an empty iterator. gate.py catches it.

CRITICAL DETAILS — exact, do not approximate:
 - min_train_size's floor is 3, NOT 2. A train array of size n yields n-1 diffs, so a size-2 train
   yields exactly ONE diff, and a mean of one diff is not a meaningful baseline scale. The floor
   and the default deliberately coincide at 3. A test asserts min_train_size=2 raises.
 - gap defaults to horizon, NOT to TimeSeriesSplit's own default of 0, so an un-overridden call
   cannot silently under-purge. A test asserts PurgedWalkForward().gap == 1.
 - This wrapper provides the EMBARGO half of Lopez de Prado's scheme, not purging. At horizon=1 a
   gap >= 1 embargo is exactly equivalent to purging (verified: at gap=1 the train fold ends at
   index 3 and the test fold starts at index 5 — no label overlap). For multi-bar labels it MUST
   raise NotImplementedError naming the missing purge rather than silently under-purging. Do NOT
   implement combinatorial purged CV — that is explicitly out of scope.
 - All four checks live in __init__, not in a caller. A later task calls this from evaluate() and
   inherits the bounds by construction; the tests construct it directly and must be bounded
   identically. One enforcement point, not two.
 - Measured fold boundaries the tests assert (train_first, train_last, test_first, test_last) for
   n_splits=3, gap=2 on 20 points: (0,2,5,9), (0,7,10,14), (0,12,15,19). And for n_splits=5, gap=4
   on 20 points the train SIZES are [1, 4, 7, 10, 13]. Both reproduce exactly on scikit-learn
   1.9.0. These are correct — do not adjust the implementation to make them come out differently.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch mase.py, brier.py, fees.py, sortino.py, gate.py or pipeline.py.
 - Do not import or reference GateVerdict, Fold or FoldSkipReason here — this module knows nothing
   about verdicts. It only splits.
 - Do not subclass TimeSeriesSplit or BaseCrossValidator. Compose (hold one, call it), don't
   inherit — the project rule is composition over inheritance, and this class deliberately does
   not implement the full sklearn splitter protocol.
 - Do not add a random_state parameter. Nothing here samples.

<<< tests/evaluation/test_walk_forward.py — write this file verbatim >>>
[paste the test_walk_forward.py code block from Step 1 of Task 6]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 6

Validating Task 6 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_walk_forward.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_walk_forward.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `walk_forward.py` and `test_walk_forward.py` may appear

Correctness read:

- **Test integrity:** was `test_walk_forward.py` altered? Any `skip`/`xfail`? Automatic FAIL.
- **Sentinel resolved in the body:** confirm `gap: int | None = None` in the signature and `horizon if gap is None else gap` inside `__init__` — not an attempted default expression referencing `horizon`.
- **All four bounds in `__init__`:** `min_train_size >= 3` (**3**, not 2 — check the literal), `n_splits >= 2`, `horizon >= 1`, `gap >= horizon`. Each message must name its parameter. Bounds enforced anywhere other than `__init__` is a FAIL.
- **`NotImplementedError` for `horizon > 1`** and its message contains "purging" (or "purg").
- **`split()` does not filter:** read it. Does it apply `min_train_size`? It must not — that belongs to `gate.py`, so a rejected fold is recorded rather than swallowed. Silent filtering here is a FAIL even though most tests would still pass.
- **`ValueError` propagates:** confirm no `try`/`except` around the `TimeSeriesSplit` call.
- **Composition, not inheritance:** confirm `PurgedWalkForward` does not subclass `TimeSeriesSplit` or `BaseCrossValidator`.
- **No verdict coupling:** confirm `GateVerdict`, `Fold`, `FoldSkipReason` are not imported here.
- **No randomness:** confirm no `random_state` parameter and no sampling.
- **Purity:** no I/O, no logging, no clock, no global mutable state.
- **Comment style / annotations:** one-line module abstract; one-line comment per method; no multi-line docstrings; `split` return type is an iterator of index-array pairs.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 7: Layer 4b — the gate  *(depends on Tasks 2 and 6)*

**Seam note.** `run_gate(request, splitter) -> GateVerdict` is the story's most load-bearing interface: one call in, one verdict out, and the verdict is the *only* thing the pipeline consults before deciding whether L1–L3 run at all. It hides three separately-discovered failure modes behind a single return value — total split infeasibility (run-level), per-fold size and degeneracy rejection (recorded, not fatal), and the point-in-time audit. Crucially, the degeneracy check lives here rather than in `mase()`, because the promise "`INVALID` means L1–L3 were never called" and "Layer 1 detects degeneracy" cannot both be true. Moving one already-computed quantity — `mean(|Δy_train|)`, which the gate can compute since it already holds the fold indices and `returns` — one layer up resolves that contradiction without new data.

**Files:**
- Create: `src/forecasting_agent/evaluation/gate.py`
- Test: `tests/evaluation/test_gate.py`

**Interfaces:**
- Consumes: `types.EvalRequest`, `types.GateVerdict`, `types.Fold`, `types.FoldSkipReason` (Task 1); `mase.train_baseline` (Task 2); `walk_forward.PurgedWalkForward` (Task 6).
- Produces: `run_gate(request: EvalRequest, splitter: PurgedWalkForward) -> GateVerdict`
  - Run-level `reasons` are drawn from exactly: `"infeasible_split_configuration"`, `"insufficient_valid_folds"`, `"timestamps_exceed_as_of"`.
  - `FoldSkipReason.detail` formats are exactly `f"train size {n} < min_train_size {min_train_size}"` and `f"mean(|Δy_train|) = {value}"` where `value` ∈ `{"nan", "inf", "0.0"}`.

- [ ] **Step 1: Write the failing test**

`tests/evaluation/test_gate.py`:

```python
"""Tests for Layer 4b — the run-level gate verdict, per-fold rejection, and the point-in-time audit."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from forecasting_agent.evaluation.gate import run_gate
from forecasting_agent.evaluation.types import EvalRequest
from forecasting_agent.evaluation.walk_forward import PurgedWalkForward


def _request(returns: list[float], *, as_of_offset_days: int = 3650) -> EvalRequest:
    """Takes a return series and an as_of offset; returns a coherent all-hold EvalRequest over it."""
    n = len(returns)
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return EvalRequest(
        returns=returns,
        forecasts=[0.0] * n,
        calls=[0.5] * n,
        timestamps=[start + timedelta(days=i) for i in range(n)],
        as_of=start + timedelta(days=as_of_offset_days),
        segment="EQUITY_DELIVERY",
        position_notional=[10_000.0] * n,
        trade_side=["hold"] * n,
        capital=1_000_000.0,
    )


def _varied(n: int) -> list[float]:
    """Takes a length; returns a deterministic non-constant return series of that length."""
    return [float(np.sin(i) * 0.01) for i in range(n)]


def test_healthy_request_is_valid_with_all_folds_surviving() -> None:
    verdict = run_gate(_request(_varied(60)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "VALID"
    assert list(verdict.reasons) == []
    assert len(verdict.folds) == 3
    assert list(verdict.skipped) == []
    assert [f.fold_number for f in verdict.folds] == [0, 1, 2]


def test_timestamps_after_as_of_make_the_run_invalid() -> None:
    verdict = run_gate(_request(_varied(60), as_of_offset_days=10), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert "timestamps_exceed_as_of" in verdict.reasons


def test_infeasible_split_is_run_level_and_never_populates_skipped() -> None:
    verdict = run_gate(_request(_varied(10)), PurgedWalkForward(n_splits=4, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert list(verdict.reasons) == ["infeasible_split_configuration"]
    assert list(verdict.folds) == []
    assert list(verdict.skipped) == []


def test_below_min_train_size_fold_is_skipped_with_the_pinned_detail_format() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    assert verdict.status == "VALID"
    assert [s.fold_number for s in verdict.skipped] == [0]
    assert verdict.skipped[0].reason == "below_min_train_size"
    assert verdict.skipped[0].detail == "train size 1 < min_train_size 3"
    assert [f.fold_number for f in verdict.folds] == [1, 2, 3, 4]


def test_fold_numbers_use_emission_order_and_are_never_renumbered() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    survivors = {f.fold_number for f in verdict.folds}
    skipped = {s.fold_number for s in verdict.skipped}
    assert survivors & skipped == set()
    assert survivors | skipped == set(range(5))
    assert 0 not in survivors


def test_constant_series_skips_every_fold_for_degenerate_baseline() -> None:
    verdict = run_gate(_request([0.01] * 60), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "INVALID"
    assert list(verdict.reasons) == ["insufficient_valid_folds"]
    assert [s.reason for s in verdict.skipped] == ["degenerate_baseline"] * 3
    assert verdict.skipped[0].detail == "mean(|Δy_train|) = 0.0"
    assert list(verdict.folds) == []


def test_fewer_than_two_valid_folds_is_run_level_invalid() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=12))
    assert verdict.status == "INVALID"
    assert "insufficient_valid_folds" in verdict.reasons
    assert len(verdict.folds) < 2


def test_exactly_two_valid_folds_is_still_valid() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=9))
    assert len(verdict.folds) == 2
    assert verdict.status == "VALID"
    assert list(verdict.reasons) == []


def test_below_min_train_size_takes_precedence_over_degenerate_baseline() -> None:
    verdict = run_gate(_request([0.01] * 20), PurgedWalkForward(n_splits=5, gap=4, horizon=1, min_train_size=3))
    by_number = {s.fold_number: s for s in verdict.skipped}
    assert by_number[0].reason == "below_min_train_size"
    assert by_number[1].reason == "degenerate_baseline"


def test_surviving_folds_carry_the_splitter_index_arrays() -> None:
    verdict = run_gate(_request(_varied(20)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    fold = verdict.folds[0]
    assert list(fold.train_idx) == [0, 1, 2]
    assert list(fold.test_idx) == [5, 6, 7, 8, 9]
    assert max(fold.train_idx) < min(fold.test_idx)


def test_gate_never_raises_on_any_of_its_documented_failure_modes() -> None:
    for splitter in (
        PurgedWalkForward(n_splits=4, gap=2, horizon=1),
        PurgedWalkForward(n_splits=3, gap=2, horizon=1),
    ):
        for series in ([0.01] * 10, _varied(10)):
            verdict = run_gate(_request(series), splitter)
            assert verdict.status in {"VALID", "INVALID"}


def test_gate_does_not_call_the_mase_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    import forecasting_agent.evaluation.gate as gate_module

    def _explode(*_args: object, **_kwargs: object) -> float:
        raise AssertionError("gate must not invoke mase()")

    monkeypatch.setattr(gate_module, "mase", _explode, raising=False)
    verdict = run_gate(_request(_varied(60)), PurgedWalkForward(n_splits=3, gap=2, horizon=1))
    assert verdict.status == "VALID"
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest tests/evaluation/test_gate.py -v`
Expected: `ModuleNotFoundError: No module named 'forecasting_agent.evaluation.gate'`.

- [ ] **Step 3: Implement `gate.py`**

Order of operations in `run_gate`:

1. **Point-in-time audit.** If `max(request.timestamps) > request.as_of`, add `"timestamps_exceed_as_of"` to `reasons`.
2. **Split.** Call `list(splitter.split(np.asarray(request.returns, dtype=np.float64)))` inside a `try`. On `ValueError`, return `GateVerdict(status="INVALID", reasons=[... , "infeasible_split_configuration"], folds=[], skipped=[])` immediately — `skipped` stays empty, because no fold was ever produced to record.
3. **Per-fold checks**, in emission order, with `fold_number` = the 0-based emission index, assigned once and **never renumbered among survivors**:
   - If `len(train_idx) < splitter.min_train_size` → `FoldSkipReason(reason="below_min_train_size", detail=f"train size {len(train_idx)} < min_train_size {splitter.min_train_size}")`. **Checked first**, before the baseline is computed at all — it needs only a length comparison, so a fold failing it never reaches the baseline computation.
   - Else compute `d = train_baseline(returns[train_idx])`. If `not math.isfinite(d) or d == 0.0` → `FoldSkipReason(reason="degenerate_baseline", detail=f"mean(|Δy_train|) = {token}")` where `token` is `"nan"`, `"inf"` or `"0.0"`.
   - Else it is a survivor: `Fold(train_idx=..., test_idx=..., fold_number=...)`.
4. **Aggregation floor.** If `len(survivors) < 2`, add `"insufficient_valid_folds"` to `reasons`.
5. Return `GateVerdict(status="INVALID" if reasons else "VALID", reasons=reasons, folds=survivors if not reasons else [], skipped=skipped)`.

Contracts the tests enforce:
- `folds` holds **survivors only**. `folds` and `skipped` are **disjoint by `fold_number`, unconditionally**.
- Whenever the splitter emitted at least one fold, the two `fold_number` sets union to exactly `range(n_splits)`. On the `infeasible_split_configuration` path both are empty and the union claim does not apply — do not write it as an unconditional invariant.
- `gate.py` imports `train_baseline` from `mase.py`, **never `mase()` itself**. Calling the metric would contradict "`INVALID` means L1–L3 were never called".
- The gate **never raises** on any documented failure mode; it returns a verdict. There is no `GateFailure` exception.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest tests/evaluation/test_gate.py -v` → all PASS.

- [ ] **Step 5: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/evaluation/gate.py tests/evaluation/test_gate.py
git commit -m "feat(evaluation): add Layer 4 gate with per-fold rejection and point-in-time audit"
```

### Gemini delegation prompt — Task 7

```
[paste block S]

ADDITIONAL CONTEXT FOR THIS TASK — two modules already exist. Read them, do NOT modify them:
  src/forecasting_agent/evaluation/mase.py
      train_baseline(y_train: NDArray[np.float64]) -> float
          mean(abs(diff(y_train))), UNGUARDED — returns nan / inf / 0.0 as-is, never raises.
      (also mase(), naive_forecast(), zero_forecast_mase() — you must NOT call any of these)
  src/forecasting_agent/evaluation/walk_forward.py
      class PurgedWalkForward with attributes n_splits, gap, horizon, min_train_size and
      split(X) -> Iterator[tuple[NDArray[np.intp], NDArray[np.intp]]]. split() does NO per-fold
      filtering and lets TimeSeriesSplit's ValueError propagate.
And from types.py: EvalRequest, GateVerdict, Fold, FoldSkipReason.

YOUR TASK — Task 7: Layer 4b, the gate.

FILES YOU MAY CREATE (and no others):
  src/forecasting_agent/evaluation/gate.py
  tests/evaluation/test_gate.py

Write tests/evaluation/test_gate.py verbatim from the block at the end of this prompt, then
implement gate.py so it passes.

gate.py exposes exactly one function:
  run_gate(request: EvalRequest, splitter: PurgedWalkForward) -> GateVerdict

ALGORITHM — implement exactly this order:

 1. POINT-IN-TIME AUDIT. If max(request.timestamps) > request.as_of, append
    "timestamps_exceed_as_of" to reasons.

 2. SPLIT. folds = list(splitter.split(np.asarray(request.returns, dtype=np.float64))) inside a
    try/except ValueError. On ValueError, return IMMEDIATELY:
      GateVerdict(status="INVALID", reasons=[...existing..., "infeasible_split_configuration"],
                  folds=[], skipped=[])
    `skipped` stays EMPTY on this path — no fold was ever produced to record. This is a distinct
    run-level path, never a FoldSkipReason.

 3. PER-FOLD CHECKS, in emission order. fold_number is the 0-BASED EMISSION INDEX, assigned once,
    before any filtering, and NEVER renumbered among survivors.
      a. if len(train_idx) < splitter.min_train_size:
             FoldSkipReason(fold_number=i, reason="below_min_train_size",
                 detail=f"train size {len(train_idx)} < min_train_size {splitter.min_train_size}")
      b. elif not math.isfinite(d) or d == 0.0, where d = train_baseline(returns[train_idx]):
             FoldSkipReason(fold_number=i, reason="degenerate_baseline",
                            detail=f"mean(|Δy_train|) = {token}")
             token is "nan" if isnan(d), "inf" if isinf(d), else "0.0"
      c. else: Fold(train_idx=..., test_idx=..., fold_number=i)   # a survivor

 4. AGGREGATION FLOOR. If len(survivors) < 2, append "insufficient_valid_folds" to reasons.

 5. return GateVerdict(status="INVALID" if reasons else "VALID", reasons=reasons,
                       folds=(survivors if not reasons else []), skipped=skipped)

CRITICAL DETAILS — exact, do not approximate:
 - CHECK ORDER IN STEP 3 IS LOAD-BEARING. below_min_train_size is checked FIRST, using only a
   length comparison, so a fold failing it is rejected BEFORE the baseline is computed at all.
   A 1-element fold trips both conditions simultaneously (its mean|diff| is nan); the precedence
   rule makes the recorded reason deterministic. A test asserts fold 0 of a constant 20-point
   series is "below_min_train_size", not "degenerate_baseline".
 - BOTH degeneracy arms are required: `not math.isfinite(d) or d == 0.0`. math.isfinite(0.0) is
   True, so the isfinite arm alone misses a CONSTANT training series (mean|diff| exactly 0.0) —
   which is the original degenerate case. Conversely `== 0.0` alone misses nan and inf.
 - THE DETAIL STRINGS ARE PINNED EXACTLY. Tests compare them with ==:
       "train size 1 < min_train_size 3"
       "mean(|Δy_train|) = 0.0"
   Note the Greek capital delta in the second. The token set is exactly {"nan", "inf", "0.0"} —
   three values, not two. "inf" is reachable by float overflow even when every element is finite.
 - MEMBERSHIP CONTRACT: `folds` holds SURVIVORS ONLY. `folds` and `skipped` are disjoint by
   fold_number UNCONDITIONALLY. Whenever the splitter emitted at least one fold, the two
   fold_number sets union to exactly range(n_splits). On the infeasible_split_configuration path
   BOTH are empty and the union claim does NOT apply — do NOT write the union as an unconditional
   assertion or invariant in the code; it would break the infeasible path.
 - IMPORT train_baseline FROM mase.py, and NOTHING ELSE from it. Do NOT call mase(),
   naive_forecast() or zero_forecast_mase(). The whole point of computing the baseline here is
   that the design promises "INVALID means Layers 1-3 were never called" — if Layer 1 were doing
   the detecting, that promise would be false. A test monkeypatches `mase` in your module's
   namespace to explode if invoked.
 - THE GATE NEVER RAISES on any documented failure mode. It RETURNS a verdict. There is no
   GateFailure exception anywhere in this package — do not create one.
 - Reasons vocabulary is exactly these three strings and no others:
   "infeasible_split_configuration", "insufficient_valid_folds", "timestamps_exceed_as_of".

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do not create or touch mase.py, brier.py, fees.py, sortino.py, walk_forward.py or pipeline.py.
 - Do NOT modify mase.py or walk_forward.py — read them, import from them, leave them alone.
   Both are already reviewed.
 - Do not construct a PurgedWalkForward inside gate.py — it is injected as a parameter.
 - Do not compute any metric here. The gate decides; it does not score.

<<< tests/evaluation/test_gate.py — write this file verbatim >>>
[paste the test_gate.py code block from Step 1 of Task 7]
```

Dispatch with: `run_agy(prompt=<above>, add_dirs=["/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6"], mode="accept-edits")`.

### Validator brief — Task 7

Validating Task 7 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`.
**No edit authority. Report findings only.**

Failing test file: `tests/evaluation/test_gate.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_gate.py -v`
2. `uv run pytest tests/ -v`
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `git status --porcelain` — only `gate.py` and `test_gate.py` may appear. **`git diff src/forecasting_agent/evaluation/mase.py src/forecasting_agent/evaluation/walk_forward.py` must be empty** — any change there is an automatic FAIL.

Correctness read — this is the most contract-heavy task, so read the code, not just the results:

- **Test integrity:** was `test_gate.py` altered? Any `skip`/`xfail`? Any `==` on a detail string relaxed to `in`? Automatic FAIL.
- **No metric call:** confirm `gate.py` imports **only** `train_baseline` from `mase.py`. Any import or call of `mase`, `naive_forecast`, `zero_forecast_mase`, `brier`, or `sortino` is a FAIL — it would falsify the design's "`INVALID` means L1–L3 were never called" promise.
- **Check precedence:** confirm `below_min_train_size` is tested **before** the baseline is computed (not merely before it is *reported*). If `train_baseline` is called unconditionally and the branch chosen afterwards, report it — the design requires the size check to short-circuit the computation.
- **Both degeneracy arms:** confirm `not math.isfinite(d) or d == 0.0`. A single-arm guard is a FAIL.
- **Detail strings byte-exact:** `f"train size {n} < min_train_size {mts}"` and `f"mean(|Δy_train|) = {token}"` with the Greek capital delta. Token set exactly `{"nan","inf","0.0"}` — confirm all three branches exist, not just two.
- **Infeasible path:** confirm the `except ValueError` branch returns with `folds=[]` **and** `skipped=[]`, and that `"infeasible_split_configuration"` never appears as a `FoldSkipReason.reason`.
- **Fold numbering:** confirm `fold_number` is the emission index, assigned before filtering, never renumbered. Look for any `enumerate` over survivors — that would be the collision bug this contract exists to prevent.
- **Union invariant not hardcoded:** confirm no unconditional assertion/invariant in the source claims `folds ∪ skipped == range(n_splits)`. That is false on the infeasible path and would break it.
- **Never raises:** confirm no `raise` statement in `run_gate` for any documented failure mode, and that no `GateFailure` class was created.
- **Reasons vocabulary:** confirm only the three permitted strings appear.
- **Aggregation floor:** confirm `< 2` (so exactly 2 survivors is `VALID`).
- **Purity:** no I/O, no logging, no `datetime.now()`, no randomness, no mutation of `request`.
- **Comment style / annotations:** one-line module abstract, one-line comment on `run_gate` and any helper; no multi-line docstrings; everything annotated.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Task 8: Pipeline orchestration, public surface, and the architecture test  *(depends on all)*

**Seam note.** `evaluate(request, *, horizon, min_train_size, n_splits, gap) -> EvalResult` is the package's entire public surface. Splitter configuration is a *call parameter*, never an `EvalRequest` field, because `EvalRequest` is data — what happened, priced and timestamped — while `horizon`/`n_splits`/`gap`/`min_train_size` are evaluation *methodology*, which can legitimately vary across two calls scoring the identical request. Keeping them separate is what preserves the "same inputs, same score" guarantee: a walk-forward sensitivity sweep re-evaluates one `EvalRequest` at several `n_splits` without constructing several requests. `__init__.py` exports exactly four names, so the read-only mount presents a surface a consumer cannot accidentally reach around.

**Files:**
- Create: `src/forecasting_agent/evaluation/pipeline.py`
- Modify: `src/forecasting_agent/evaluation/__init__.py` (currently the empty Task 1 placeholder)
- Test: `tests/evaluation/test_pipeline.py`
- Test: `tests/evaluation/test_architecture.py`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `evaluate(request: EvalRequest, *, horizon: int = 1, min_train_size: int = 3, n_splits: int = 5, gap: int | None = None) -> EvalResult`; `__init__.py` re-exports `evaluate`, `EvalRequest`, `EvalResult`, `GateVerdict` and sets `__all__` to exactly those four.

- [ ] **Step 1: Write the failing tests**

`tests/evaluation/test_pipeline.py`:

```python
"""End-to-end tests for evaluate() — gate short-circuit, per-fold scoring, and layer_means floors."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from forecasting_agent.evaluation import EvalRequest, EvalResult, GateVerdict, evaluate


def _request(
    returns: list[float],
    *,
    as_of_offset_days: int = 3650,
    sides: list[str] | None = None,
    notional: list[float] | None = None,
) -> EvalRequest:
    """Takes a return series plus optional sides/notional; returns a coherent EvalRequest over it."""
    n = len(returns)
    start = datetime(2025, 1, 1, tzinfo=UTC)
    return EvalRequest(
        returns=returns,
        forecasts=[0.0] * n,
        calls=[0.6 if r > 0 else 0.4 for r in returns],
        timestamps=[start + timedelta(days=i) for i in range(n)],
        as_of=start + timedelta(days=as_of_offset_days),
        segment="EQUITY_DELIVERY",
        position_notional=notional if notional is not None else [10_000.0] * n,
        trade_side=sides if sides is not None else ["hold"] * n,  # type: ignore[arg-type]
        capital=1_000_000.0,
    )


def _varied(n: int) -> list[float]:
    """Takes a length; returns a deterministic non-constant return series of that length."""
    return [float(np.sin(i) * 0.01) for i in range(n)]


def test_public_surface_exports_exactly_four_names() -> None:
    import forecasting_agent.evaluation as package

    assert set(package.__all__) == {"evaluate", "EvalRequest", "EvalResult", "GateVerdict"}


def test_healthy_run_is_valid_and_scores_every_surviving_fold() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    assert isinstance(result, EvalResult)
    assert result.verdict.status == "VALID"
    assert len(result.verdict.folds) == 3
    assert {score.layer for score in result.layers} == {1, 2, 3}
    assert len([s for s in result.layers if s.layer == 1]) == 3


def test_scores_are_per_fold_not_one_whole_series_score() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    layer_one_folds = sorted(s.fold_number for s in result.layers if s.layer == 1)
    assert layer_one_folds == [0, 1, 2]
    assert len({s.value for s in result.layers if s.layer == 1}) > 1


def test_invalid_run_returns_an_evalresult_with_empty_layers_and_means() -> None:
    result = evaluate(_request(_varied(120), as_of_offset_days=10), n_splits=3, gap=2, horizon=1)
    assert isinstance(result, EvalResult)
    assert isinstance(result.verdict, GateVerdict)
    assert result.verdict.status == "INVALID"
    assert list(result.layers) == []
    assert result.layer_means == {}


def test_invalid_run_never_calls_the_metric_layers(monkeypatch: pytest.MonkeyPatch) -> None:
    import forecasting_agent.evaluation.pipeline as pipeline_module

    def _explode(*_args: object, **_kwargs: object) -> float:
        raise AssertionError("Layers 1-3 must not run when the gate is INVALID")

    for name in ("mase", "zero_forecast_mase", "brier", "calibration_bins", "sortino"):
        monkeypatch.setattr(pipeline_module, name, _explode, raising=False)
    result = evaluate(_request(_varied(120), as_of_offset_days=10), n_splits=3, gap=2, horizon=1)
    assert result.verdict.status == "INVALID"


def test_layer_one_carries_the_zero_forecast_fields() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    layer_one = [s for s in result.layers if s.layer == 1]
    for score in layer_one:
        assert score.zero_forecast_mase is not None
        assert score.beats_zero is not None
        assert score.calibration_bins is None
        assert score.annualized is None


def test_layer_two_carries_all_ten_calibration_bins() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    for score in (s for s in result.layers if s.layer == 2):
        assert score.calibration_bins is not None
        assert len(score.calibration_bins) == 10
        assert score.zero_forecast_mase is None


def test_layer_three_carries_the_annualized_flag() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    for score in (s for s in result.layers if s.layer == 3):
        assert score.annualized is not None
        assert score.zero_forecast_mase is None


def test_layer_means_present_with_n_folds_for_layers_one_and_two() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, gap=2, horizon=1)
    valid_folds = len(result.verdict.folds)
    assert valid_folds >= 2
    assert result.layer_means[1].n_folds == valid_folds
    assert result.layer_means[2].n_folds == valid_folds
    assert result.layer_means[1].mean == pytest.approx(
        float(np.mean([s.value for s in result.layers if s.layer == 1 and s.value is not None]))
    )


def test_layer_three_mean_absent_when_fewer_than_two_folds_have_downside() -> None:
    n = 120
    sides = ["hold"] * n
    notional = [0.0] * n
    result = evaluate(_request(_varied(n), sides=sides, notional=notional), n_splits=3, gap=2, horizon=1)
    assert result.verdict.status == "VALID"
    assert all(s.note == "no_downside_observations" for s in result.layers if s.layer == 3)
    assert 3 not in result.layer_means
    assert 1 in result.layer_means


def test_every_layerscore_fold_number_joins_against_surviving_folds() -> None:
    result = evaluate(_request(_varied(20)), n_splits=5, gap=4, horizon=1, min_train_size=3)
    survivors = {f.fold_number for f in result.verdict.folds}
    skipped = {s.fold_number for s in result.verdict.skipped}
    assert {s.fold_number for s in result.layers} <= survivors
    assert survivors & skipped == set()


def test_gap_defaults_to_horizon_when_omitted() -> None:
    result = evaluate(_request(_varied(120)), n_splits=3, horizon=1)
    assert result.verdict.status == "VALID"


def test_parameter_bounds_surface_as_value_errors() -> None:
    request = _request(_varied(120))
    with pytest.raises(ValueError, match="min_train_size"):
        evaluate(request, min_train_size=2)
    with pytest.raises(ValueError, match="n_splits"):
        evaluate(request, n_splits=1)
    with pytest.raises(NotImplementedError, match="purg"):
        evaluate(request, horizon=2, gap=2)


def test_same_inputs_always_produce_the_same_score() -> None:
    request = _request(_varied(120))
    first = evaluate(request, n_splits=3, gap=2, horizon=1)
    second = evaluate(request, n_splits=3, gap=2, horizon=1)
    assert first.model_dump() == second.model_dump()
```

`tests/evaluation/test_architecture.py`:

```python
"""Architecture test — the evaluation package's import closure contains no first-party module outside it."""

import ast
import pathlib

PACKAGE_DIR = pathlib.Path(__file__).resolve().parents[2] / "src" / "forecasting_agent" / "evaluation"
FIRST_PARTY_ROOT = "forecasting_agent"
ALLOWED_PREFIX = "forecasting_agent.evaluation"


def _imported_modules(source: str) -> set[str]:
    """Takes Python source text; returns the set of absolute module names it imports."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module is not None:
            names.add(node.module)
    return names


def test_package_directory_is_discoverable() -> None:
    assert PACKAGE_DIR.is_dir()
    assert (PACKAGE_DIR / "pipeline.py").is_file()


def test_no_first_party_import_outside_the_evaluation_package() -> None:
    offenders: list[tuple[str, str]] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        for module in _imported_modules(path.read_text(encoding="utf-8")):
            if module.split(".")[0] == FIRST_PARTY_ROOT and not module.startswith(ALLOWED_PREFIX):
                offenders.append((path.name, module))
    assert offenders == []


def test_no_forbidden_runtime_dependencies_are_imported() -> None:
    forbidden = {"pandas", "scipy", "statsmodels", "requests", "httpx", "logging", "sqlalchemy", "psycopg"}
    offenders: list[tuple[str, str]] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        for module in _imported_modules(path.read_text(encoding="utf-8")):
            if module.split(".")[0] in forbidden:
                offenders.append((path.name, module))
    assert offenders == []


def test_no_module_reaches_for_the_wall_clock() -> None:
    offenders: list[str] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if "datetime.now(" in source or "date.today(" in source or "time.time(" in source:
            offenders.append(path.name)
    assert offenders == []
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `uv run pytest tests/evaluation/test_pipeline.py tests/evaluation/test_architecture.py -v`
Expected: `test_pipeline.py` fails on `ImportError: cannot import name 'evaluate'`; `test_architecture.py` fails on `assert (PACKAGE_DIR / "pipeline.py").is_file()`.

- [ ] **Step 3: Implement `pipeline.py`**

```python
def evaluate(
    request: EvalRequest,
    *,
    horizon: int = 1,
    min_train_size: int = 3,
    n_splits: int = 5,
    gap: int | None = None,
) -> EvalResult:
```

Body, in order:

1. `splitter = PurgedWalkForward(n_splits=n_splits, gap=gap, horizon=horizon, min_train_size=min_train_size)`. The splitter's constructor owns all four bound checks and the `gap is None → horizon` resolution — `evaluate()` inherits them by construction and must **not** re-implement them. `ValueError` / `NotImplementedError` surface to the caller unchanged.
2. `verdict = run_gate(request, splitter)`.
3. If `verdict.status == "INVALID"`, return `EvalResult(verdict=verdict, layers=[], layer_means={})` and **stop**. L1–L3 must never run. `layers` and `layer_means` are empty, not omitted.
4. Otherwise, for each surviving `Fold`, compute in order L1, L2, L3 over that fold's `test_idx` (with `train_idx` supplying MASE's denominator), appending one `LayerScore` per layer per fold, each carrying that fold's `fold_number`:
   - **L1:** `value=mase(train, test, naive_forecast(train, test))`, `zero_forecast_mase=zero_forecast_mase(train, test)`, `beats_zero = value < zero_forecast_mase`. Other optional fields `None`.
   - **L2:** `value=brier(calls[test_idx], returns[test_idx])`, `calibration_bins=calibration_bins(calls[test_idx], returns[test_idx])`. Other optional fields `None`.
   - **L3:** `period = cost_adjusted_period_returns(...)` over `test_idx`, then `result = sortino(period)`; `value=result.value`, `annualized=result.annualized`, `note=result.note`. Other optional fields `None`.
5. `layer_means`: for each layer in `1, 2, 3`, take that layer's `LayerScore.value`s **where the value is not `None`**. If two or more remain, set `layer_means[layer] = LayerMean(mean=<their mean>, n_folds=<their count>)`. If fewer than two, **omit the key entirely** — a caller checks `layer in result.layer_means`. This per-layer floor is independent of, and additional to, the gate's request-level `< 2` floor; the gate's floor counts gate-valid folds and does not protect Layer 3, which can have most of its folds return `None`.
6. Return `EvalResult(verdict=verdict, layers=layers, layer_means=layer_means)`.

Import every metric function into `pipeline.py`'s **module namespace** (`from ...mase import mase, naive_forecast, zero_forecast_mase`, etc.), so the monkeypatch-based "never called" test can target them.

- [ ] **Step 4: Fill in `__init__.py`**

```python
"""Public surface of the read-only M8 evaluation engine."""

from forecasting_agent.evaluation.pipeline import evaluate
from forecasting_agent.evaluation.types import EvalRequest, EvalResult, GateVerdict

__all__ = ["EvalRequest", "EvalResult", "GateVerdict", "evaluate"]
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `uv run pytest tests/evaluation/ -v` → all PASS.

- [ ] **Step 6: Run the full gate**

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy src/ tests/evaluation/
uv run bandit -r src/ -c pyproject.toml -ll
uv run pytest tests/ -v
make check
```

- [ ] **Step 7: Commit**

```bash
git add src/forecasting_agent/evaluation/pipeline.py src/forecasting_agent/evaluation/__init__.py \
        tests/evaluation/test_pipeline.py tests/evaluation/test_architecture.py
git commit -m "feat(evaluation): compose L4-L1-L2-L3 pipeline and export the public evaluate() surface"
```

### Gemini delegation prompt — Task 8

> **Recommended: do not delegate Task 8.** It is the only task requiring architectural judgment rather than transcription, and it is the sole writer of the package's public surface. If you do delegate it, the prompt below is complete.

```
[paste block S]

ADDITIONAL CONTEXT FOR THIS TASK — all seven sibling modules already exist and are reviewed.
Read them; do NOT modify any of them:
  types.py       EvalRequest, EvalResult, LayerScore, LayerMean, CalibrationBin, GateVerdict,
                 Fold, FoldSkipReason
  errors.py      DegenerateBaselineError
  mase.py        mase(y_train, y_test, forecast) -> float
                 naive_forecast(y_train, y_test) -> NDArray[np.float64]
                 zero_forecast_mase(y_train, y_test) -> float
                 train_baseline(y_train) -> float
  brier.py       brier(calls, returns) -> float
                 calibration_bins(calls, returns) -> list[CalibrationBin]   # always 10 entries
  fees.py        IndianFeeSchedule().total_fee(notional, side, segment, trade_date) -> float
  sortino.py     cost_adjusted_period_returns(returns=, position_notional=, trade_side=,
                     timestamps=, segment=, capital=, schedule=) -> NDArray[np.float64]
                 sortino(period_returns) -> SortinoResult(value: float|None, annualized: bool,
                                                          note: str|None)
  walk_forward.py  PurgedWalkForward(*, n_splits=5, gap=None, horizon=1, min_train_size=3)
  gate.py        run_gate(request, splitter) -> GateVerdict

YOUR TASK — Task 8: pipeline orchestration, public surface, architecture test.

FILES YOU MAY CREATE OR MODIFY (and no others):
  src/forecasting_agent/evaluation/pipeline.py    (create)
  src/forecasting_agent/evaluation/__init__.py    (modify — currently an empty placeholder)
  tests/evaluation/test_pipeline.py               (create)
  tests/evaluation/test_architecture.py           (create)

Write both test files verbatim from the blocks at the end of this prompt, then implement.

pipeline.py exposes exactly one function:

  def evaluate(request: EvalRequest, *, horizon: int = 1, min_train_size: int = 3,
               n_splits: int = 5, gap: int | None = None) -> EvalResult:

BODY, in this exact order:

 1. splitter = PurgedWalkForward(n_splits=n_splits, gap=gap, horizon=horizon,
                                 min_train_size=min_train_size)
    The splitter's __init__ owns ALL FOUR bound checks and the `gap is None -> horizon`
    resolution. Do NOT re-implement any of them here — one enforcement point, not two. Let its
    ValueError / NotImplementedError surface to the caller unchanged.

 2. verdict = run_gate(request, splitter)

 3. if verdict.status == "INVALID":
        return EvalResult(verdict=verdict, layers=[], layer_means={})
    STOP HERE. Layers 1-3 must NEVER run on this path. `layers` and `layer_means` are EMPTY, not
    omitted — an omitted required field is a ValidationError, not an intentional "nothing here".
    A test monkeypatches every metric name in your module namespace to explode if called.

 4. For each surviving Fold in verdict.folds, in order, compute L1 then L2 then L3 and append one
    LayerScore per layer, each carrying that fold's fold_number (NOT a re-enumerated index):
      L1: train = returns[fold.train_idx]; test = returns[fold.test_idx]
          value = mase(train, test, naive_forecast(train, test))
          zero  = zero_forecast_mase(train, test)
          LayerScore(layer=1, fold_number=fold.fold_number, value=value,
                     zero_forecast_mase=zero, beats_zero=(value < zero))
          all other optional fields left None
      L2: LayerScore(layer=2, fold_number=..., value=brier(calls[test_idx], returns[test_idx]),
                     calibration_bins=calibration_bins(calls[test_idx], returns[test_idx]))
          all other optional fields left None
      L3: period = cost_adjusted_period_returns(returns=..., position_notional=...,
                       trade_side=..., timestamps=..., segment=request.segment,
                       capital=request.capital, schedule=IndianFeeSchedule())
                   — all sliced to fold.test_idx
          r = sortino(period)
          LayerScore(layer=3, fold_number=..., value=r.value, annualized=r.annualized, note=r.note)
          all other optional fields left None

 5. layer_means: for layer in (1, 2, 3), collect that layer's LayerScore.value WHERE THE VALUE IS
    NOT None. If two or more remain:
        layer_means[layer] = LayerMean(mean=<their arithmetic mean>, n_folds=<their count>)
    If FEWER THAN TWO remain, OMIT THE KEY ENTIRELY. Do not store 0.0, do not store None.

 6. return EvalResult(verdict=verdict, layers=layers, layer_means=layer_means)

__init__.py becomes exactly:

  """Public surface of the read-only M8 evaluation engine."""

  from forecasting_agent.evaluation.pipeline import evaluate
  from forecasting_agent.evaluation.types import EvalRequest, EvalResult, GateVerdict

  __all__ = ["EvalRequest", "EvalResult", "GateVerdict", "evaluate"]

CRITICAL DETAILS — exact, do not approximate:
 - L1-L3 are computed PER FOLD and aggregated — never once over the whole series. A single-shot
   score over full history is not walk-forward validated and would quietly undo Layer 4. A test
   asserts one LayerScore per layer per surviving fold and that the Layer-1 values differ.
 - THE PER-LAYER layer_means FLOOR (n_folds >= 2) IS SEPARATE FROM AND ADDITIONAL TO the gate's
   request-level floor. The gate's floor counts gate-VALID folds, a property of `returns` alone;
   layer_means[3] counts only folds whose Layer-3 value is non-None. Measured failure this closes:
   5 gate-valid folds where 4 report "no_downside_observations" still passes the gate's floor and
   would produce a layer_means[3] computed over exactly ONE fold, read downstream as a
   walk-forward aggregate. A test drives exactly this case and asserts `3 not in layer_means`.
 - A None value is EXCLUDED from the mean, never coerced to 0.0. Coercing would silently reward
   the exact ambiguity None was introduced to avoid propagating.
 - Import every metric function into pipeline.py's MODULE NAMESPACE
   (`from forecasting_agent.evaluation.mase import mase, naive_forecast, zero_forecast_mase`,
   and likewise brier/calibration_bins/sortino/cost_adjusted_period_returns). A test
   monkeypatches those names on your module, which only works if they are bound at module scope.
 - Splitter config (horizon / min_train_size / n_splits / gap) is a CALL PARAMETER, never an
   EvalRequest field. EvalRequest is DATA; these are METHODOLOGY, and can legitimately vary across
   two calls scoring the identical request. Do not move them onto the model.
 - fold_number on every LayerScore must be the Fold's own fold_number, taken from the verdict —
   NOT a fresh enumerate() index over survivors. A test asserts every LayerScore.fold_number is a
   member of the survivor set.
 - evaluate() must be deterministic: same request, same kwargs, byte-identical model_dump(). No
   clock, no randomness, no ordering that depends on set iteration.

BOUNDARIES SPECIFIC TO THIS TASK:
 - Do NOT modify types.py, errors.py, mase.py, brier.py, fees.py, sortino.py, walk_forward.py or
   gate.py. Read them, import from them, leave them alone. All seven are already reviewed.
 - Do not modify conftest.py or any other task's test file.
 - Do not add persistence, logging, caching, or an incremental/streaming API — a re-score
   recomputes everything, by design, and that is what keeps eval history comparable.
 - Do not add import guards, checksums, or any "am I being tampered with" check. The read-only
   boundary is enforced by the container mount in a different story; anything in-process would be
   decoration that reads as security.
 - __all__ contains exactly four names. Do not export metric functions or internal types.

<<< tests/evaluation/test_pipeline.py — write this file verbatim >>>
[paste the test_pipeline.py code block from Step 1 of Task 8]

<<< tests/evaluation/test_architecture.py — write this file verbatim >>>
[paste the test_architecture.py code block from Step 1 of Task 8]
```

### Validator brief — Task 8

Validating Task 8 in `/mnt/c/Users/vama0/Desktop/Forecasting_Agent-issue-6`. This is the final task, so validate the **whole story**, not only the diff.
**No edit authority. Report findings only.**

Failing test files: `tests/evaluation/test_pipeline.py`, `tests/evaluation/test_architecture.py`

Gates — run each, report **PASS/FAIL** with output:

1. `uv run pytest tests/evaluation/test_pipeline.py tests/evaluation/test_architecture.py -v`
2. `uv run pytest tests/ -v` — the **entire** suite, all eight test modules
3. `uv run ruff check .`
4. `uv run ruff format --check .`
5. `uv run mypy src/ tests/evaluation/` — must print `Success: no issues found`
6. `uv run bandit -r src/ -c pyproject.toml -ll`
7. `make check`
8. `git status --porcelain` — only `pipeline.py`, `__init__.py`, `test_pipeline.py`, `test_architecture.py` may appear. **`git diff` against the other seven modules must be empty** — any change is an automatic FAIL.

Correctness read:

- **Test integrity:** were either test file altered? Any `skip`/`xfail`? Automatic FAIL.
- **Gate short-circuit:** confirm the `INVALID` branch returns before any metric call and returns `layers=[]`, `layer_means={}` — empty, not omitted.
- **No duplicated bound checks:** confirm `evaluate()` does **not** re-validate `min_train_size`/`n_splits`/`horizon`/`gap`. Those belong to `PurgedWalkForward.__init__` only. A second copy here is a FAIL even though tests pass.
- **Per-fold, not whole-series:** confirm the metric calls are inside a loop over `verdict.folds`, and that MASE's train slice comes from `fold.train_idx` while every scored quantity comes from `fold.test_idx`.
- **`fold_number` provenance:** confirm every `LayerScore.fold_number` is `fold.fold_number`, not a loop counter.
- **`layer_means` floor:** read the aggregation. Is the `>= 2` check applied **per layer**, on the count of non-`None` values for *that* layer? Is the key **omitted** below the floor rather than set to `0.0`/`None`? Is `None` **excluded** from the mean rather than coerced?
- **Optional-field discipline:** confirm L1 scores leave `calibration_bins`/`annualized`/`note` as `None`, L2 leaves `zero_forecast_mase`/`beats_zero`/`annualized` as `None`, L3 leaves `zero_forecast_mase`/`beats_zero`/`calibration_bins` as `None`.
- **Module-namespace imports:** confirm the metric functions are imported at module scope in `pipeline.py` (required for the monkeypatch test to be meaningful, not just to pass).
- **Public surface:** confirm `__all__ == ["EvalRequest", "EvalResult", "GateVerdict", "evaluate"]` — exactly four names, nothing else exported.
- **No forbidden additions:** confirm no persistence, no logging, no caching, no streaming/incremental API, and no import guard / checksum / tamper-detection code anywhere in the package.
- **Determinism:** confirm no set-iteration ordering leaks into `layers` or `layer_means`, no clock, no randomness. `test_same_inputs_always_produce_the_same_score` passing is necessary but read the code too.
- **Whole-story sweep:** list every file under `src/forecasting_agent/evaluation/` and `tests/evaluation/` and confirm the set is exactly: `__init__.py`, `types.py`, `errors.py`, `mase.py`, `brier.py`, `fees.py`, `sortino.py`, `walk_forward.py`, `pipeline.py`; and `__init__.py`, `conftest.py`, `test_types.py`, `test_mase.py`, `test_brier.py`, `test_fees.py`, `test_sortino.py`, `test_walk_forward.py`, `test_gate.py`, `test_pipeline.py`, `test_architecture.py`. Report any extra or missing file.
- **Toolchain still correct:** confirm `Makefile`'s `lint:` runs `uv run mypy src/ tests/evaluation/` and `ci.yml` has the `Type-check with mypy` step in `lint-and-test`.
- **Comment style / annotations:** spot-check every new file for the one-line module abstract and one-line per-function comments; flag any multi-line docstring.

Final verdict: **PASS** or **FAIL** with a numbered defect list including `file:line`.

---

## Self-Review

### 1. Spec coverage

| Spec section | Task |
|---|---|
| Structure — `types.py`, `errors.py` (`DegenerateBaselineError` only; no `GateFailure`, no `EvaluationError`) | 1 |
| Structure — `tests/evaluation/__init__.py`, seeded `conftest.py` | 1 |
| Decision 1 — Hyndman train-fold denominator, `m=1`, naive ≠ 1.0 | 2 |
| Decision 2 — `zero_forecast_mase` + `beats_zero` reported, not gated | 2 (function), 8 (surfaced on `LayerScore`) |
| Decision 3 — both guard arms; `min_train_size` default 3; gate is primary detector, `mase()` defense-in-depth | 2 (metric guard), 6 (`min_train_size`), 7 (gate detection) |
| Decision 3b — `FoldSkipReason` accounting, `< 2` valid folds ⇒ run-level `INVALID` | 7 |
| Decision 4 — `brier_score_loss(scale_by_half=True)`, sklearn>=1.7 pin, hand-rolled 10-bin `np.digitize`, bin-edge precision | 1 (pin), 3 |
| Decision 5 — `PurgedWalkForward` wraps `TimeSeriesSplit`, `gap >= horizon`, `NotImplementedError` on multi-bar, `ValueError` propagates | 6 (splitter), 7 (`infeasible_split_configuration`) |
| Decision 6 — four segment profiles, buy/sell asymmetry, flat DP, DP outside GST base, `effective_from` selection, brokerage default 0, rates as literals + source in docstring | 4 |
| Decision 7 — exposure-weighted cost-adjusted returns, MAR 0, divide by N, `None` not `inf`, 252/20 named constants, numerator/denominator annualization | 5 |
| Decision 7b — every field type, length-mismatch error contract, buy/sell notional coherence, Brier label rule, all eight result models | 1 |
| Decision 7b — "aggregated" defined; `LayerMean{mean, n_folds}`; per-layer `>= 2` floor | 8 |
| Decision 8 — no self-protection code | 8 (validator brief checks for its absence) |
| Decision 9 — pure functions; `evaluate()` signature; splitter config as call params not request fields; bounds in `PurgedWalkForward.__init__`; no `random_state` | 6 (bounds), 8 (signature) |
| Decision 10 — numpy / scikit-learn>=1.7 / pydantic>=2; no pandas/scipy/statsmodels | 1 |
| SOLID / Clean Architecture — SRP per module, DIP import-closure test, no `Metric` ABC | Global Constraints + 8 (import-closure test) |
| Testing — MASE bullets | 2 |
| Testing — Brier bullets (incl. `scale_by_half=True` literal assertion, all-10-bins, boundary bin) | 3 |
| Testing — `EvalRequest` bullets (length mismatch, `capital <= 0`, `calls` out of range) | 1 |
| Testing — Fees bullets (all four segments, DP dominance, GST base, `effective_from`) | 4 |
| Testing — Sortino bullets (hand-computed, `None` not `inf`, divide-by-N, annualization agreement, exposure weighting, flat hold) | 5 |
| Testing — Walk-forward bullets (measured boundaries, `gap < horizon`, `horizon > 1`, infeasible, `[1,4,7,10,13]`, train < test property) | 6 (+ infeasible→verdict in 7) |
| Testing — Gate bullets (`as_of`, L1–L3 never called, gate-side degeneracy, `< 2` folds, infeasible distinct) | 7 (+ pipeline-level never-called in 8) |
| Testing — Pipeline bullets (`layer_means` H20 regression, per-fold aggregation) | 8 |
| Testing — Architecture (import closure) | 8 |
| Hypothesis properties — `MASE >= 0` guarded, `0 <= Brier <= 1`, fee-fraction strictly decreasing bounded/10×-separated | 2, 3, 4 |
| Toolchain — deps + `uv lock`; `Makefile` `mypy src/ tests/evaluation/`; `ci.yml` direct mypy step; same-commit ordering; full strict annotation of the new suite | 1 |
| Out of Scope items | Not implemented anywhere; the Task 8 validator brief explicitly checks for absence of persistence, mounts, CPCV, self-protection |

No spec requirement is unassigned.

### 2. Placeholder scan

No `TBD`, `TODO`, "implement later", "add appropriate error handling", "handle edge cases", or "similar to Task N" appears in this plan. Every test step carries runnable code. Every delegation prompt carries its scope, acceptance criterion, standards, and boundaries. The two paste markers that do appear — `[paste block S]` and `[paste the <file> code block from Step N of Task M]` — are mechanical instructions pointing at text that exists verbatim in this document, not deferred content.

### 3. Type consistency

Cross-checked every name that crosses a task boundary:
- `train_baseline` — defined Task 2, consumed Task 7. Same name, same signature `(NDArray[np.float64]) -> float`, same unguarded contract in both descriptions.
- `PurgedWalkForward` attributes `n_splits`/`gap`/`horizon`/`min_train_size` — set Task 6, read Task 7 (`splitter.min_train_size`) and constructed Task 8. Consistent.
- `IndianFeeSchedule.total_fee(position_notional, trade_side, segment, trade_date)` — four parameters, defined Task 4, called Task 5 with four arguments. Consistent (the spec's own H15→H19 defect was a three-argument call site against a four-argument signature; checked explicitly).
- `cost_adjusted_period_returns` keyword names (`returns`, `position_notional`, `trade_side`, `timestamps`, `segment`, `capital`, `schedule`) — declared Task 5, called by keyword in Task 5's tests and in Task 8. Identical in all three.
- `SortinoResult(value, annualized, note)` — Task 5; unpacked into `LayerScore.value/annualized/note` in Task 8. Field names align.
- `CalibrationBin(count, mean_predicted, mean_observed)` — Task 1; built Task 3; carried on `LayerScore.calibration_bins` Task 8.
- `run_gate(request, splitter) -> GateVerdict` — Task 7; called Task 8. Consistent.
- `evaluate(request, *, horizon, min_train_size, n_splits, gap)` — Task 8, matching the spec's decision-9 signature exactly, including `gap: int | None = None` as a sentinel.
- Reason strings — `"infeasible_split_configuration"`, `"insufficient_valid_folds"`, `"timestamps_exceed_as_of"` — spelled identically in Task 7's algorithm, its tests, and its validator brief.
- Note string — `"no_downside_observations"` — identical in Task 5 and Task 8.
- `FoldSkipReason.reason` literals — `"degenerate_baseline"`, `"below_min_train_size"` — identical in Task 1's schema and Task 7's algorithm and tests.

### 4. Test-runs-red check

**Per explicit user instruction, the plan author did not execute the failing tests; writing and running them is delegated to the implementing agents (Step 2 of each task).** What *was* independently verified, because it is the load-bearing part, is every numeric literal the tests assert against: all thirteen constants in the Global Constraints table and all eight fee-leg totals were recomputed from scratch on numpy 2.5.2 / scikit-learn 1.9.0 / pydantic 2.13.4 in this worktree, not copied from the spec. Seven of eight fee legs and thirteen of thirteen constants reproduced the spec exactly; the eighth fee leg is the `EQUITY_DELIVERY` buy discrepancy recorded under "Deviations from the spec". Each task's Step 2 states the exact expected red failure so an implementer can tell a correct RED from a broken one.

### 5. Delegation completeness

Each of Tasks 2–8 has a delegation prompt that opens with block **S** (repo location, existing modules and their signatures, acceptance criterion, full repo standards, verification commands, global boundaries), then states its own files, its own exact algorithm with every constant inline, its own critical details with the measured evidence for each, its own task-specific boundaries, and its test file verbatim. A fresh, context-free subagent can send any one of them without reading this conversation, this plan's prose, or the spec. Each validator brief names its test file path, its seven-to-eight numbered gate commands, a task-specific correctness checklist that goes beyond "tests green", and the explicit no-edit-authority instruction.

**One deliberate exception:** Task 1 is marked *not for delegation* — it is the sole serialization point, it mutates the four repo-wide shared files (`pyproject.toml`, `uv.lock`, `Makefile`, `ci.yml`), and part of its work is environment mutation (`uv add`/`uv lock`) that no test can validate. Its delegation prompt is written out in full anyway, so the choice stays reversible. Task 8 carries a softer recommendation against delegation for the same architectural-judgment reason.

## Open point for the user

The spec's `status:` frontmatter is still `proposed` despite the Review Log recording two consecutive `APPROVED` verdicts (rounds 16–17). Per the project's Dataview rule, a decided ADR should carry `status: decided` so it surfaces correctly in the hub's Key Decisions table. Flagging rather than editing, since the spec is not this plan's file to change.
