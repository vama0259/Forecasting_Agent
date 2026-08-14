# Market Data MCP Server — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md` (APPROVED, R6, two consecutive clean rounds)
**Issue:** #5 · **Branch:** `feat/issue-5-market-data-mcp` (based on current `main`, spec committed at `11dfd3e`)
**Written inline** (no `gemini-plan-writer` dispatch, per the Token-efficiency CLAUDE.md rule). Implementation delegates to Gemini via `agy` per task; validation is inline, not a dispatched Haiku/Sonnet subagent.

## Global Constraints (every task must respect these)

1. `mcp>=1.24.0,<2.0.0` — never let a task pull `mcp` 2.0.0. `FastMCP` lives at `mcp.server.fastmcp.FastMCP`.
2. `cleaner.py`'s Hampel/MAD filter is hand-rolled (pandas/numpy `.rolling(20)`) — **no `scipy.signal.hampel`**, it doesn't exist.
3. Plugins import `contracts.py` only. `server.py` talks only to `registry.py`. Enforced by `import-linter`, not convention.
4. `fetch_ohlcv(symbol, market, start, end, as_of=None)` / `fetch_option_chain(underlying, expiry, as_of=None)` — this signature, not the ADR's literal `(symbol, market, range)` (spec decision 7).
5. All Pydantic v2 models real classes, never bare `dict` return types — `FastMCP` produces a schema-less output for a `dict` return (verified during spec review).
6. Outliers are **clipped (Winsorized), never dropped** — the continuous time index is load-bearing for point-in-time filtering and calendar alignment.

## File Structure

```
src/forecasting_agent/data_server/
  __init__.py
  contracts.py       Task 1
  server.py          Task 6 (last — depends on everything)
  plugins.yaml        Task 4
  point_in_time.py   Task 2
  cleaner.py          Task 3
  normalizer.py       Task 3
  cache.py            Task 5
  plugins/
    __init__.py
    base.py           Task 4
    nse.py            Task 4
    registry.py        Task 4
tests/data_server/
  test_contracts.py            Task 1
  test_point_in_time.py         Task 2
  test_cleaner.py               Task 3
  test_nse_plugin.py            Task 4
  test_pipeline_integration.py  Task 6
pyproject.toml         Task 1 (adds mcp/pydantic/yfinance/pandas/numpy/import-linter deps)
.importlinter           Task 4
```

## Dependency Ordering & Parallel Dispatch

```
Task 1 (contracts.py + package scaffold + pyproject deps)  ── sequential, blocks everything
   │
   ├── Task 2 (point_in_time.py)   ─┐
   ├── Task 3 (cleaner.py + normalizer.py) ─┼── dispatch in parallel, each its own worktree
   ├── Task 4 (plugins/ + registry + import-linter) ─┘
   │
Task 5 (cache.py)  ── needs contracts only, can run alongside 2/3/4 too — widen the parallel wave
   │
Task 6 (server.py + integration test)  ── sequential, last, needs 2/3/4/5 all landed
```

**Independence check:** Tasks 2/3/4/5 each write to disjoint files (`point_in_time.py` / `cleaner.py`+`normalizer.py` / `plugins/**`+`.importlinter` / `cache.py`) and each only *reads* Task 1's `contracts.py` — none writes to it. Safe to run all four in parallel worktrees. Task 6 writes `server.py`, which imports all of them — must be last, and its own integration test is the only thing that proves the pieces actually compose, not just individually pass.

---

## Task 1: Package scaffold + `contracts.py`

**Seam note.** `contracts.py` is the one file every other module depends on and none of them write to — the interface that makes parallel dispatch of Tasks 2–5 safe. Getting it wrong here means every downstream task inherits the mistake.

**Files:** `src/forecasting_agent/data_server/__init__.py`, `contracts.py`; `pyproject.toml` (add deps); `tests/data_server/__init__.py`, `test_contracts.py`.

**Step 1 — write the failing test, confirm red:**

```python
# tests/data_server/test_contracts.py
from datetime import date
import pytest
from pydantic import ValidationError
from forecasting_agent.data_server.contracts import OHLCVBar, OHLCVResponse, SymbolMeta, MarketMeta


def test_ohlcv_bar_accepts_valid_shape():
    bar = OHLCVBar(
        date=date(2024, 1, 1),
        open=100.0,
        high=105.0,
        low=99.0,
        close=103.0,
        volume=1000,
        is_outlier=False,
        is_circuit_locked=False,
    )
    assert bar.close == 103.0


def test_ohlcv_bar_rejects_negative_volume():
    with pytest.raises(ValidationError):
        OHLCVBar(date=date(2024, 1, 1), open=100.0, high=105.0, low=99.0, close=103.0, volume=-1)


def test_ohlcv_response_nests_bars():
    resp = OHLCVResponse(symbol="RELIANCE.NS", market="NSE", bars=[], data_stale=False)
    assert resp.bars == []


def test_symbol_meta_requires_market():
    with pytest.raises(ValidationError):
        SymbolMeta(symbol="RELIANCE.NS")  # market missing
```

Run: `uv run pytest tests/data_server/test_contracts.py -v` — expected failure: `ModuleNotFoundError: No module named 'forecasting_agent.data_server'` (module doesn't exist yet). That's the red.

**Step 2 — Gemini delegation prompt:**

```
Implement src/forecasting_agent/data_server/__init__.py and contracts.py in the
Forecasting_Agent repo. This is Task 1 of a 6-task plan — read
docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md in full first,
section "Tool Surface" and "Structure" specifically.

The failing test at tests/data_server/test_contracts.py is the acceptance criterion —
make it pass, do not weaken it.

Build these Pydantic v2 (BaseModel) classes in contracts.py:
- MarketMeta: market code (str), display name (str), timezone (str)
- SymbolMeta: symbol (str), market (str, required), exchange_suffix (str, e.g. ".NS")
- OHLCVBar: date (date), open/high/low/close (float, must be > 0), volume (int, must be >= 0),
  is_outlier (bool, default False), is_circuit_locked (bool, default False)
- OHLCVResponse: symbol (str), market (str), bars (list[OHLCVBar]), data_stale (bool, default False)
- FnOChainResponse: underlying (str), expiry (date), strikes (list — define a nested StrikeData
  model with strike price, call/put OI, call/put LTP), data_stale (bool, default False)

Also add these dependencies to pyproject.toml's [project.dependencies] (do not touch existing
deps): mcp[cli]>=1.24.0,<2.0.0 ; pydantic>=2.13 ; yfinance>=1.6.0 ; pandas ; numpy. Add
import-linter>=2.13 to the dev dependency group.

Boundaries: do not create server.py, cleaner.py, or any other module from the spec — only
contracts.py, __init__.py, and the pyproject.toml dependency additions. Do not modify the test
file.

Run `uv run pytest tests/data_server/test_contracts.py -v` yourself and confirm all 4 tests pass
before finishing.
```

**Validator brief (inline, run by me after Gemini returns):**
- Run `uv run pytest tests/data_server/test_contracts.py -v` — all 4 pass, real output pasted, not summarized.
- Run `uv run python -c "import mcp; print(mcp.__version__)"` — confirm `<2.0.0`.
- `grep -n "scipy" pyproject.toml src/forecasting_agent/data_server/contracts.py` — must be empty (nothing in Task 1 should touch scipy).
- Read `contracts.py` directly — confirm every field Task 2–6 will need actually exists (cross-check against the spec's Tool Surface section return types).

---

## Task 2: `point_in_time.py`

**Seam note.** The interface is `filter_as_of(bars, as_of) -> bars` plus a `LeakageError` type — small and total. It's the one piece every acceptance-criterion test ("prevents future data leakage") hangs off, so it must be independently correct before `server.py` wires it in.

**Files:** `point_in_time.py`; `tests/data_server/test_point_in_time.py`.

**Step 1 — failing test:**

```python
# tests/data_server/test_point_in_time.py
from datetime import date, timedelta
import pytest
from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.point_in_time import filter_as_of, LeakageError


def _bar(d):
    return OHLCVBar(date=d, open=1, high=1, low=1, close=1, volume=1)


def test_future_as_of_raises_leakage_error():
    with pytest.raises(LeakageError):
        filter_as_of([_bar(date.today())], as_of=date.today() + timedelta(days=1))


def test_past_as_of_excludes_later_bars():
    bars = [_bar(date(2024, 1, 1)), _bar(date(2024, 1, 5)), _bar(date(2024, 1, 10))]
    result = filter_as_of(bars, as_of=date(2024, 1, 5))
    assert [b.date for b in result] == [date(2024, 1, 1), date(2024, 1, 5)]


def test_no_as_of_returns_everything():
    bars = [_bar(date(2024, 1, 1)), _bar(date(2024, 1, 5))]
    assert filter_as_of(bars, as_of=None) == bars
```

Run, confirm red: `ModuleNotFoundError` for `point_in_time`.

**Step 2 — Gemini delegation prompt:**

```
Implement src/forecasting_agent/data_server/point_in_time.py in the Forecasting_Agent repo.
Task 2 of 6 — read docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md's "Error
Handling" section first.

The failing test at tests/data_server/test_point_in_time.py is the acceptance criterion.

Build:
- class LeakageError(Exception) — raised when as_of is in the future relative to today
  (use date.today() as the comparison point, not datetime.now() — this deals in dates, not times)
- def filter_as_of(bars: list[OHLCVBar], as_of: date | None) -> list[OHLCVBar] — if as_of is
  None, return bars unchanged. If as_of is in the future, raise LeakageError immediately, before
  touching bars. Otherwise return only bars with bar.date <= as_of.

Import OHLCVBar from forecasting_agent.data_server.contracts — do not redefine it.

Boundaries: only point_in_time.py. Do not touch contracts.py, cleaner.py, or any other module.
Do not modify the test file.

Run `uv run pytest tests/data_server/test_point_in_time.py -v` and confirm all 3 pass before
finishing.
```

**Validator brief:** run the test file directly, all 3 pass; read `point_in_time.py` and confirm the future-check happens before any filtering (not after — a leak that's filtered-then-checked could still process the data).

---

## Task 3: `cleaner.py` + `normalizer.py`

**Seam note.** Two files, one seam: both are pure functions over a bar sequence (`list[OHLCVBar] -> list[OHLCVBar]`), no I/O, no MCP awareness — composable in `server.py` without either needing to know the other exists. This is where the spec's most dangerous drift-risk lives (the nonexistent `scipy.signal.hampel`), so the test has to pin the actual clipping behavior, not just "runs without error."

**Files:** `cleaner.py`, `normalizer.py`; `tests/data_server/test_cleaner.py`.

**Step 1 — failing test:**

```python
# tests/data_server/test_cleaner.py
from datetime import date, timedelta
from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.cleaner import hampel_clip


def _series(closes):
    base = date(2024, 1, 1)
    return [
        OHLCVBar(date=base + timedelta(days=i), open=c, high=c, low=c, close=c, volume=100)
        for i, c in enumerate(closes)
    ]


def test_clips_not_drops_an_injected_outlier():
    closes = [100.0] * 25 + [500.0] + [100.0] * 5  # spike at index 25
    bars = _series(closes)
    result = hampel_clip(bars, window=20, threshold=3.5)
    assert len(result) == len(bars)  # nothing dropped
    assert result[25].is_outlier is True
    assert result[25].close < 500.0  # clipped, not left at the spike value
    assert result[0].close == 100.0  # untouched normal bars stay untouched


def test_no_outliers_leaves_series_unchanged():
    bars = _series([100.0] * 30)
    result = hampel_clip(bars, window=20, threshold=3.5)
    assert all(not b.is_outlier for b in result)
    assert [b.close for b in result] == [100.0] * 30
```

Run, confirm red.

**Step 2 — Gemini delegation prompt:**

```
Implement src/forecasting_agent/data_server/cleaner.py and normalizer.py in the
Forecasting_Agent repo. Task 3 of 6 — read
docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md's discrepancy-resolution
item 4 FIRST, it explains an implementation trap.

CRITICAL: there is no scipy.signal.hampel function. Do not import scipy.signal. Build the
Hampel/MAD filter by hand using pandas: a causal rolling median (pandas .rolling(window).median())
and rolling MAD (median absolute deviation from that rolling median, NOT the mean), both computed
only from bars up to and including the current one (causal — a lookahead window is not allowed,
it would leak future data into a "cleaned" past bar).

The failing test at tests/data_server/test_cleaner.py is the acceptance criterion.

Build in cleaner.py:
- def hampel_clip(bars: list[OHLCVBar], window: int = 20, threshold: float = 3.5) ->
  list[OHLCVBar] — for each bar, compute the causal rolling median and MAD of `close` over the
  trailing `window` bars. If |close - median| > threshold * MAD, clip close to
  median + sign(close - median) * threshold * MAD, and set is_outlier=True on that bar. Return a
  new list (do not mutate the input bars) — bars are Pydantic models, use .model_copy(update=...).

Build in normalizer.py (no test file yet — implement per the spec's "Structure" section only,
this file's test is Task 6's integration test):
- def align_calendar(bars: list[OHLCVBar], max_staleness_days: int = 3) -> list[OHLCVBar] —
  forward-fill missing trading days using the last known bar, but only up to
  max_staleness_days; beyond that, do not fabricate a bar.

Boundaries: only cleaner.py and normalizer.py. Do not touch contracts.py or point_in_time.py.
Do not modify the test file.

Run `uv run pytest tests/data_server/test_cleaner.py -v` and confirm both tests pass before
finishing.
```

**Validator brief:** run the test, both pass; `grep -rn "scipy" src/forecasting_agent/data_server/cleaner.py` must be empty; read `hampel_clip`'s implementation and confirm the window is genuinely causal (uses `.rolling(window, min_periods=...)` without a `center=True` or a shifted/lookahead index) — this is the one thing a test on synthetic data can miss if the synthetic series happens to be symmetric enough not to expose it, so read the code, don't just trust the test result.

---

## Task 4: `plugins/` + `registry.py` + `plugins.yaml` + import-linter

**Seam note.** `MarketPlugin` (base.py) is the actual seam — small (`fetch()`, `supports()`, `symbol_pattern`), and every future market (US/crypto/forex, later stories) implements it without ever importing `registry.py` or `server.py`. `import-linter` makes that boundary real instead of a comment.

**Files:** `plugins/__init__.py`, `base.py`, `nse.py`, `registry.py`, `plugins.yaml`; `.importlinter`; `tests/data_server/test_nse_plugin.py`.

**Step 1 — failing test:**

```python
# tests/data_server/test_nse_plugin.py
from unittest.mock import patch, MagicMock
from datetime import date
import pandas as pd
from forecasting_agent.data_server.plugins.nse import NsePlugin


def test_supports_ns_and_bo_suffixes():
    plugin = NsePlugin()
    assert plugin.supports("RELIANCE.NS")
    assert plugin.supports("RELIANCE.BO")
    assert not plugin.supports("AAPL")


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_fetch_maps_yfinance_response_to_ohlcv_bar(mock_download):
    mock_download.return_value = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [105.0],
            "Low": [99.0],
            "Close": [103.0],
            "Volume": [1000],
        },
        index=pd.to_datetime([date(2024, 1, 1)]),
    )
    plugin = NsePlugin()
    bars = plugin.fetch("RELIANCE.NS", date(2024, 1, 1), date(2024, 1, 1))
    assert len(bars) == 1
    assert bars[0].close == 103.0
    assert bars[0].volume == 1000
```

Run, confirm red.

**Step 2 — Gemini delegation prompt:**

```
Implement the plugins/ package and registry.py in the Forecasting_Agent repo's
src/forecasting_agent/data_server/. Task 4 of 6 — read
docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md's "Import-Linter Discipline"
section first.

The failing test at tests/data_server/test_nse_plugin.py is the acceptance criterion for nse.py.

Build:
- plugins/base.py: abstract class MarketPlugin (use abc.ABC) with abstract methods
  fetch(symbol: str, start: date, end: date) -> list[OHLCVBar], supports(symbol: str) -> bool,
  and a symbol_pattern property. Import ONLY from contracts.py — never from registry, server, or
  another plugin.
- plugins/nse.py: class NsePlugin(MarketPlugin) wrapping yfinance (`import yfinance as yf`).
  supports() returns True for symbols ending in ".NS" or ".BO". fetch() calls
  yf.download(symbol, start=start, end=end) and maps the returned DataFrame's Open/High/Low/
  Close/Volume columns into a list[OHLCVBar] (use the DataFrame index as each bar's date).
- registry.py: reads plugins.yaml (a simple market-name -> module-path mapping), imports each
  listed plugin module, instantiates it, and exposes resolve(market: str) -> MarketPlugin. Raise
  a clear error if a market isn't in the manifest.
- plugins.yaml at src/forecasting_agent/data_server/plugins.yaml: register NSE and BSE both
  pointing at the same nse.py module (one plugin instance handles both suffixes).
- .importlinter at the repo root: a contract enforcing that files under
  src/forecasting_agent/data_server/plugins/ import only from
  forecasting_agent.data_server.contracts, never from forecasting_agent.data_server.registry or
  forecasting_agent.data_server.server or sibling plugin modules. Use the "layers" or "forbidden"
  contract type, whichever import-linter's syntax makes cleaner for this rule.

Boundaries: only the plugins/ package, registry.py, plugins.yaml, .importlinter. Do not touch
contracts.py, cleaner.py, point_in_time.py, or normalizer.py. Do not modify the test file.

Run `uv run pytest tests/data_server/test_nse_plugin.py -v` and confirm both pass. Then run
`uv run lint-imports` (or `uv run python -m importlinter`) and confirm the contract passes with
no violations, before finishing.
```

**Validator brief:** run the test, both pass; run `uv run lint-imports` (or equivalent import-linter invocation), confirm the plugin-isolation contract reports no violations — then, as an adversarial check, deliberately grep `plugins/nse.py` and `plugins/base.py` for `import registry` or `import server` to confirm the linter would actually have caught a violation if one existed (a contract with a typo that matches nothing still "passes" trivially).

---

## Task 5: `cache.py`

**Seam note.** The interface is `get(key) -> bars | None` / `put(key, bars)` / `is_stale(key) -> bool` — small enough that a future Redis layer (explicitly out of scope, per the spec) can sit behind the same three methods without touching any caller.

**Files:** `cache.py`; no dedicated test file — covered by Task 6's integration test per the spec's Testing section (Parquet I/O is more honestly tested end-to-end than mocked).

**Step 1 — failing check (not a pytest file, a direct run):**

```
uv run python -c "from forecasting_agent.data_server.cache import ParquetCache"
```
Expected red: `ModuleNotFoundError`.

**Step 2 — Gemini delegation prompt:**

```
Implement src/forecasting_agent/data_server/cache.py in the Forecasting_Agent repo. Task 5 of
6 — read docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md's "Data Flow" and
decision 6 (Redis deferred) first.

Build class ParquetCache with:
- __init__(self, cache_dir: str = "data/cache/ohlcv") — creates the directory if missing.
- get(self, symbol: str, market: str) -> list[OHLCVBar] | None — reads a Parquet file keyed by
  symbol+market if it exists, deserializes into OHLCVBar list, else returns None.
- put(self, symbol: str, market: str, bars: list[OHLCVBar]) -> None — writes bars to Parquet
  (use pandas: build a DataFrame from the bars, then .to_parquet()).
- is_stale(self, symbol: str, market: str, max_staleness_days: int = 3) -> bool — True if no
  cached data exists, or if the most recent cached bar's date is more than max_staleness_days
  before today.

This is the ONLY cache implementation for this story — no Redis code, no Redis import, no
Redis-shaped abstraction beyond these three plain methods (a future story adds Redis in front of
this, not inside it).

Boundaries: only cache.py. Do not touch any other module.

Confirm `uv run python -c "from forecasting_agent.data_server.cache import ParquetCache;
c = ParquetCache(cache_dir='/tmp/cachetest'); print(c.get('RELIANCE.NS', 'NSE'))"` runs without
error and prints None before finishing.
```

**Validator brief:** run the smoke command above myself, confirm it prints `None` with no traceback; read the file and confirm no `redis` import anywhere.

---

## Task 6: `server.py` + integration test

**Seam note.** This is the only file that imports everything else — the actual MCP tool surface. Its test is the one thing that proves the pieces from Tasks 1–5 compose correctly, not just pass individually; a plan this parallelized needs exactly one point where that gets checked for real.

**Files:** `server.py`; `tests/data_server/test_pipeline_integration.py`. **Must start only after Tasks 2, 3, 4, 5 are all merged/landed on this branch.**

**Step 1 — failing test:**

```python
# tests/data_server/test_pipeline_integration.py
from unittest.mock import patch
from datetime import date
import pandas as pd
from forecasting_agent.data_server.server import fetch_ohlcv


@patch("forecasting_agent.data_server.plugins.nse.yf.download")
def test_full_pipeline_returns_validated_response(mock_download):
    mock_download.return_value = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [105.0],
            "Low": [99.0],
            "Close": [103.0],
            "Volume": [1000],
        },
        index=pd.to_datetime([date(2024, 1, 1)]),
    )
    result = fetch_ohlcv("RELIANCE.NS", "NSE", "2024-01-01", "2024-01-01", as_of=None)
    assert result.symbol == "RELIANCE.NS"
    assert len(result.bars) == 1


def test_future_as_of_raises_leakage_error_through_the_full_tool():
    from forecasting_agent.data_server.point_in_time import LeakageError
    import pytest

    with pytest.raises(LeakageError):
        fetch_ohlcv(
            "RELIANCE.NS",
            "NSE",
            "2024-01-01",
            "2024-01-01",
            as_of=str(date.today().replace(year=date.today().year + 1)),
        )
```

Run, confirm red: `server` doesn't exist.

**Step 2 — Gemini delegation prompt:**

```
Implement src/forecasting_agent/data_server/server.py in the Forecasting_Agent repo. Task 6 of
6, the final integration task — read
docs/superpowers/specs/2026-08-14-market-data-mcp-server-design.md's "Tool Surface" section in
full, this is the literal contract to implement.

The failing test at tests/data_server/test_pipeline_integration.py is the acceptance criterion.

Build using FastMCP (from mcp.server.fastmcp import FastMCP — NOT mcp.server.mcpserver, that's
the 2.0.0 API this repo doesn't use):

  app = FastMCP("market-data")

  @app.tool()
  def list_markets() -> list[MarketMeta]: ...

  @app.tool()
  def resolve_symbol(symbol: str, market: str) -> SymbolMeta: ...

  @app.tool()
  def fetch_ohlcv(symbol: str, market: str, start: str, end: str, as_of: str | None = None) -> OHLCVResponse: ...

  @app.tool()
  def fetch_option_chain(underlying: str, expiry: str, as_of: str | None = None) -> FnOChainResponse: ...

fetch_ohlcv's pipeline, in order: registry.resolve(market) to get the plugin -> check cache via
ParquetCache, fetch from the plugin only on a cache miss or stale entry -> hampel_clip() ->
align_calendar() -> filter_as_of() (this MUST run last, right before returning — filtering
before cleaning would let a future bar influence the rolling window statistics used to clean past
bars) -> wrap in OHLCVResponse, with data_stale=True set if cache.is_stale() was true for the
data actually returned -> cache.put() the result before returning.

fetch_option_chain can be a minimal working implementation — NSE F&O via yfinance's options
chain interface, same point-in-time treatment. list_markets/resolve_symbol read from the plugin
registry directly, no cleaning pipeline needed.

Boundaries: only server.py. Do not modify contracts.py, cleaner.py, normalizer.py,
point_in_time.py, cache.py, or any plugin file — if something there seems wrong, report it, do
not silently patch it.

Run `uv run pytest tests/data_server/ -v` (the FULL data_server test suite, not just this file)
and confirm every test across all 6 tasks still passes before finishing — this is the one task
that can regress an earlier one by wiring things together wrong.
```

**Validator brief:** run `uv run pytest tests/data_server/ -v` myself — every test from every task, not just Task 6's own. Read `server.py`'s `fetch_ohlcv` and confirm the exact pipeline order (clean → normalize → filter-as-of last), since an out-of-order pipeline would still pass the two integration tests above but silently produce wrong `is_outlier` flags on any bar near an `as_of` boundary — the test doesn't catch ordering, only presence.

## Toolchain Integration

After Task 6, verify (not build — this repo's Makefile/CI already cover `src/`+`tests/` broadly; #4 wired the two-stack split, this story stays entirely Python):
- `uv run mypy src/forecasting_agent/data_server/` — should be clean given Pydantic v2's type-safety, if not, fix before calling the story done.
- `make check` — full run, confirm the new `data_server/` code doesn't break the existing Python suite.

## Out of Scope (unchanged from spec)

Redis · non-NSE/BSE plugins · `entry_points` auto-discovery · downstream confidence-penalty application · harness-side MCP client wiring · agent-created plugins outside the sandbox.
