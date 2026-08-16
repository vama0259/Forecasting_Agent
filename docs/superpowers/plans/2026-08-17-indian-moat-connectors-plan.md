# Indian Moat Connectors (#20) — Implementation Plan

> **For agentic workers:** implementation goes to Gemini via `agy` (`gemini-delegated-implementation`),
> verified inline after each task — not executed by this plan's author directly.

**Goal:** Build `flows` (participant-wise F&O OI) and `microstructure` (delivery %, bulk/block deals)
as MCP-exposed connectors reading from the observation archive (#19), plus the two new archive
downloaders (delivery position, bulk/block deals) #20's own scope requires but #19 never built.

**Spec:** `docs/superpowers/specs/2026-08-17-indian-moat-connectors-design.md` (one independent
`/advisor` review round, `APPROVED` — read decisions 1-6 before touching any task).

**Branch / worktree:** same as #19 — `feat/issue-19-20-observation-archive-and-connectors`,
`.claude/worktrees/feat+issue-19-20-archive-connectors/`.

**Scope note:** `macro_in` and FII/DII cash-market flows are explicitly OUT of this plan — tracked as
issue #32, parked until search infra (#21) exists. Do not build them here.

## Delegation Boundary

Same as #19's plan: Gemini's job is implementation only. No Obsidian, no final smoke test, no push,
no PR, no files outside a task's declared list. Smoke Test and Obsidian Sync sections at the end are
Claude's job, after all tasks are verified.

## Global Constraints

- One-line file/function comments only, no docstrings (CLAUDE.md hard rule).
- **Task order is a hard dependency chain: 1 → 2 → 3 → 4 → 5 → 6 → 7.** Task 1 (new downloaders) must
  land before Task 5/6 (connector plugins) — a connector has nothing to parse until its source has
  been archived at least once. Do not reorder.
- **Task 3 (`filter_as_of` generalization) touches a function `fetch_ohlcv` already depends on.**
  Every task from here on that runs tests must run `uv run pytest tests/data_server/ -v` (the whole
  directory, not just new files) so a regression there surfaces immediately, not just the new test's
  own pass/fail.
- Real Postgres + real archived data required for Tasks 5/6's tests (same `forecasting_agent-postgres-1`
  container #19 used) — not mocked, per CLAUDE.md's documented Gemini quality gap.

---

## Task 1: Two new archive downloaders — delivery position, bulk/block deals

**Files:**
- Create: `src/forecasting_agent/archive/downloaders/nse_delivery_position.py`
- Create: `src/forecasting_agent/archive/downloaders/nse_bulk_block_deals.py`
- Modify: `src/forecasting_agent/archive/run_daily.py` (register the two new downloaders)
- Modify: `tests/archive/test_downloaders.py`
- Modify: `tests/archive/test_run_daily.py`
- Create fixtures: `tests/archive/fixtures/delivery_position_sample.DAT`,
  `tests/archive/fixtures/bulk_deals_sample.csv`

**Interfaces:**
- Produces: `NseDeliveryPositionDownloader(Downloader)` — `fetch_raw(observed_on) -> bytes`, URL
  `https://archives.nseindia.com/archives/equities/mto/MTO_{observed_on:%d%m%Y}.DAT`, same
  retry/404-as-gap pattern as `NseParticipantOiDownloader` (#19's existing code — read it before
  writing this, copy its retry/backoff shape exactly, don't reinvent it).
  `NseBulkBlockDealsDownloader(Downloader)` — **two methods, not one `fetch_raw`**, since bulk and
  block are two independent NSE files with independent content:
  `fetch_bulk(observed_on) -> bytes` (`https://archives.nseindia.com/content/equities/bulk.csv`) and
  `fetch_block(observed_on) -> bytes` (`.../block.csv`) — `observed_on` is accepted but not used to
  build the URL (both are always-latest-day files, verified live this session — the parameter exists
  so `run_daily.py`'s uniform downloader-dict shape still works, and so a future caller can't call
  this without at least stating what date it believes it's archiving). **These never raise
  `SourceUnavailableError` on a normal empty response** — verified live, `block.csv` returns `HTTP 200`
  with a `NO RECORDS` body on a day with no block deals, not a 404. Only a genuine `404`/transport
  failure is an error condition here.
- Consumed by Task 2's contracts indirectly (via what gets archived), by `run_daily.py` directly, and
  by Task 6's `microstructure.py` (reads what this archives).

**Seam note:** `NseBulkBlockDealsDownloader` breaks the one-`fetch_raw`-method pattern the other three
downloaders use, deliberately — it has two genuinely independent payloads. Do not force it into the
`Downloader` ABC's single-method shape; give it its own two public methods and have `run_daily.py`
call each explicitly with its own `source` string (`"bulk_deals"`, `"block_deals"`).

- [ ] **Step 1: Write the failing test**

```python
# tests/archive/test_downloaders.py -- ADD to the existing file, do not replace it
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from forecasting_agent.archive.downloaders.nse_bulk_block_deals import NseBulkBlockDealsDownloader
from forecasting_agent.archive.downloaders.nse_delivery_position import NseDeliveryPositionDownloader
from forecasting_agent.archive.errors import SourceUnavailableError

FIXTURES = Path(__file__).parent / "fixtures"


def _response(status_code: int, content: bytes = b"") -> httpx.Response:
    return httpx.Response(status_code=status_code, content=content, request=httpx.Request("GET", "https://x"))


@patch("forecasting_agent.archive.downloaders.nse_delivery_position.httpx.get")
def test_delivery_position_200_returns_bytes(mock_get: MagicMock):
    from datetime import date
    fixture_bytes = (FIXTURES / "delivery_position_sample.DAT").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseDeliveryPositionDownloader().fetch_raw(date(2026, 8, 14))

    assert result == fixture_bytes
    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_delivery_position.httpx.get")
def test_delivery_position_404_raises_immediately(mock_get: MagicMock):
    from datetime import date
    mock_get.return_value = _response(404)

    with pytest.raises(SourceUnavailableError):
        NseDeliveryPositionDownloader().fetch_raw(date(2026, 8, 15))

    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_bulk_block_deals.httpx.get")
def test_bulk_deals_200_with_records_returns_bytes(mock_get: MagicMock):
    from datetime import date
    fixture_bytes = (FIXTURES / "bulk_deals_sample.csv").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseBulkBlockDealsDownloader().fetch_bulk(date(2026, 8, 14))

    assert result == fixture_bytes


@patch("forecasting_agent.archive.downloaders.nse_bulk_block_deals.httpx.get")
def test_block_deals_200_with_no_records_body_does_not_raise(mock_get: MagicMock):
    from datetime import date
    mock_get.return_value = _response(200, b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price\nNO RECORDS,,,,,,\n")

    result = NseBulkBlockDealsDownloader().fetch_block(date(2026, 8, 14))

    assert b"NO RECORDS" in result


@patch("forecasting_agent.archive.downloaders.nse_bulk_block_deals.httpx.get")
def test_block_deals_404_raises(mock_get: MagicMock):
    from datetime import date
    mock_get.return_value = _response(404)

    with pytest.raises(SourceUnavailableError):
        NseBulkBlockDealsDownloader().fetch_block(date(2026, 8, 14))
```

```python
# tests/archive/test_run_daily.py -- ADD to the existing file
def test_run_all_downloaders_covers_all_five_sources_when_called_with_the_real_default_dict():
    from forecasting_agent.archive.run_daily import _build_default_downloaders
    downloaders = _build_default_downloaders()
    assert set(downloaders.keys()) >= {
        "bhavcopy_cm", "bhavcopy_fo", "participant_oi", "delivery_position", "bulk_deals", "block_deals",
    }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/archive/test_downloaders.py tests/archive/test_run_daily.py -v
```
Expected: `FAIL` — `ModuleNotFoundError` for the two new downloader modules; `ImportError` for
`_build_default_downloaders` (doesn't exist in `run_daily.py` yet).

- [ ] **Step 3: Implement**

1. `nse_delivery_position.py`: copy `nse_participant_oi.py`'s exact structure (retry/backoff, 404
   handling, `USER_AGENT`) — only the URL template and class name change.
2. `nse_bulk_block_deals.py`: `fetch_bulk`/`fetch_block`, each hitting its own always-`bulk.csv` /
   `block.csv` URL (no date interpolation into the URL — confirmed live this session that the date
   param is ignored). Both retry on transport failure/5xx (same 3-attempt schedule), raise
   `SourceUnavailableError` only on a genuine 404, and treat a 200-with-`NO RECORDS`-body as a normal
   successful return, not an error.
3. `run_daily.py`: extract the current inline downloader dict in `main()` into a new
   `_build_default_downloaders() -> dict[str, ...]` function (a small refactor enabling the test
   above) returning all six entries. For `bulk_deals`/`block_deals`, wrap each in a thin adapter/lambda
   matching the existing `Downloader.fetch_raw(observed_on) -> bytes` shape so `run_all_downloaders`'s
   existing loop doesn't need to change — e.g. a tiny `_BulkDealsAdapter`/`_BlockDealsAdapter` each
   wrapping one of `NseBulkBlockDealsDownloader`'s two methods behind `fetch_raw`. Keep
   `run_all_downloaders`'s signature and body untouched; only `main()`'s downloader construction changes.
4. File header + function comments per CLAUDE.md's rule.

- [ ] **Step 4-6: Run to pass, lint/typecheck/import-linter, commit**

```bash
uv run pytest tests/archive/ -v   # expect all archive tests green, not just the new ones
uv run ruff check src/forecasting_agent/archive tests/archive
uv run mypy src/forecasting_agent/archive
uv run lint-imports
git add src/forecasting_agent/archive/downloaders/nse_delivery_position.py src/forecasting_agent/archive/downloaders/nse_bulk_block_deals.py src/forecasting_agent/archive/run_daily.py tests/archive/test_downloaders.py tests/archive/test_run_daily.py tests/archive/fixtures/
git commit -m "feat: add delivery-position and bulk/block-deals archive downloaders (#20)"
```

---

## Task 2: New contracts — `FlowRecord`, `DeliveryRecord`, `BulkDealRecord`, `BlockDealRecord`, response wrappers

**Files:**
- Modify: `src/forecasting_agent/data_server/contracts.py`
- Modify: `tests/data_server/test_contracts.py`

**Interfaces:** Produces the six new Pydantic models from the spec's Contracts section (copy them
verbatim — field names/types/constraints are already pinned there, do not redesign). Consumed by
Tasks 5/6 (parsers) and Task 7 (MCP tool response types).

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_contracts.py -- ADD to the existing file
from datetime import date

import pytest
from pydantic import ValidationError


def test_flow_record_rejects_negative_contracts():
    from forecasting_agent.data_server.contracts import FlowRecord
    with pytest.raises(ValidationError):
        FlowRecord(
            observed_on=date(2026, 8, 14), participant="FII",
            future_index_long=-1, future_index_short=0, future_stock_long=0, future_stock_short=0,
            option_index_call_long=0, option_index_put_long=0, option_index_call_short=0,
            option_index_put_short=0, option_stock_call_long=0, option_stock_put_long=0,
            option_stock_call_short=0, option_stock_put_short=0,
            total_long_contracts=0, total_short_contracts=0,
        )


def test_delivery_record_rejects_percentage_over_100():
    from forecasting_agent.data_server.contracts import DeliveryRecord
    with pytest.raises(ValidationError):
        DeliveryRecord(observed_on=date(2026, 8, 14), symbol="RELIANCE", series="EQ",
                        quantity_traded=100, deliverable_quantity=50, delivery_pct=150.0)


def test_bulk_deal_record_requires_positive_price():
    from forecasting_agent.data_server.contracts import BulkDealRecord
    with pytest.raises(ValidationError):
        BulkDealRecord(observed_on=date(2026, 8, 14), symbol="RELIANCE", client_name="X",
                        buy_sell="BUY", quantity=100, price=0.0)


def test_microstructure_response_defaults_to_empty_lists_and_no_coverage_note():
    from forecasting_agent.data_server.contracts import MicrostructureResponse
    resp = MicrostructureResponse(observed_on=date(2026, 8, 14))
    assert resp.delivery == []
    assert resp.bulk_deals == []
    assert resp.block_deals == []
    assert resp.coverage_note is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_contracts.py -v
```
Expected: `FAIL` — `ImportError`, the new model names don't exist in `contracts.py` yet.

- [ ] **Step 3: Implement**

Add exactly the six models from the spec's "Contracts" section (`FlowRecord`, `DeliveryRecord`,
`BulkDealRecord`, `BlockDealRecord`, `MicrostructureResponse`, `FlowsResponse`) to `contracts.py`,
verbatim from the spec — copy the field list, types, and `Field(...)` constraints exactly as written
there. Add all six names to the existing `__all__` list (don't replace it, extend it).

- [ ] **Step 4-6: Run to pass, lint/typecheck, commit**

```bash
uv run pytest tests/data_server/test_contracts.py -v
uv run ruff check src/forecasting_agent/data_server tests/data_server
uv run mypy src/forecasting_agent/data_server
git add src/forecasting_agent/data_server/contracts.py tests/data_server/test_contracts.py
git commit -m "feat: add FlowRecord/DeliveryRecord/BulkDealRecord/BlockDealRecord contracts (#20)"
```

---

## Task 3: Generalize `filter_as_of` to `list[T] -> list[T]` — pinned mechanism, zero behavior change for existing callers

**Files:**
- Modify: `src/forecasting_agent/data_server/point_in_time.py`
- Modify: `tests/data_server/test_point_in_time.py`

**Interfaces:** Produces `filter_as_of(items: list[T], as_of: date | None, key: Callable[[T], date] =
lambda b: b.date) -> list[T]` — a generic function over any `T`, with a `key` extractor parameter
defaulting to `.date` (preserving `OHLCVBar`'s existing field name and every existing call site
unchanged). Consumed unchanged by `fetch_ohlcv` (Task 7 does NOT need to touch that call site) and by
Task 7's two new tools, which pass `key=lambda r: r.observed_on`.

**Seam note — the pinned mechanism, per the spec's explicit ask not to leave this open at
implementation time:** do not use a `Protocol`, do not rename `OHLCVBar.date`, do not add a `.date`
property to the new records. Use a plain `key: Callable[[T], date]` parameter with a default that
reproduces the exact current behavior. This is a signature *widening*, not a behavior change —
`tests/data_server/test_point_in_time.py`'s existing assertions must all still pass unmodified.

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_point_in_time.py -- ADD to the existing file, do not touch existing tests
from datetime import date


def test_filter_as_of_accepts_a_key_extractor_for_non_ohlcv_types():
    from forecasting_agent.data_server.point_in_time import filter_as_of

    class Fake:
        def __init__(self, observed_on: date) -> None:
            self.observed_on = observed_on

    items = [Fake(date(2026, 8, 10)), Fake(date(2026, 8, 20))]

    result = filter_as_of(items, as_of=date(2026, 8, 15), key=lambda f: f.observed_on)

    assert len(result) == 1
    assert result[0].observed_on == date(2026, 8, 10)


def test_filter_as_of_default_key_still_works_for_ohlcv_bars_unchanged():
    from forecasting_agent.data_server.contracts import OHLCVBar
    from forecasting_agent.data_server.point_in_time import filter_as_of

    bars = [
        OHLCVBar(date=date(2026, 8, 10), open=1, high=1, low=1, close=1, volume=1),
        OHLCVBar(date=date(2026, 8, 20), open=1, high=1, low=1, close=1, volume=1),
    ]

    result = filter_as_of(bars, as_of=date(2026, 8, 15))

    assert len(result) == 1
    assert result[0].date == date(2026, 8, 10)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_point_in_time.py -v
```
Expected: `FAIL` on the first new test only (`TypeError: filter_as_of() got an unexpected keyword
argument 'key'`) — the second new test and all pre-existing tests should already `PASS` (confirms the
default-behavior path is untouched before you even start). If any *pre-existing* test fails at this
step, stop — that means the file has drifted from what this task assumes; do not proceed until
you've confirmed why.

- [ ] **Step 3: Implement**

```python
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

def filter_as_of(items: list[T], as_of: date | None, key: Callable[[T], date] = lambda b: b.date) -> list[T]:  # type: ignore[attr-defined]
    if as_of is None:
        return items
    today = date.today()  # noqa: DTZ011
    if as_of > today:
        raise LeakageError(f"as_of date {as_of} is in the future relative to today ({today})")
    return [item for item in items if key(item) <= as_of]
```
(The `type: ignore[attr-defined]` on the default lambda is expected — mypy can't verify `.date` exists
on an unbound `TypeVar`; this is the one acceptable ignore in this task, not a pattern to repeat
elsewhere.) Rename the function's `bars` parameter to `items` throughout its body. Do NOT change
`fetch_ohlcv`'s call site (`server.py`) — the default `key` makes that unnecessary.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/data_server/ -v
```
Expected: `PASS`, full directory — this is the check that proves `fetch_ohlcv`'s existing behavior
survived the generalization untouched.

- [ ] **Step 5-6: Lint/typecheck, commit**

```bash
uv run ruff check src/forecasting_agent/data_server tests/data_server
uv run mypy src/forecasting_agent/data_server
git add src/forecasting_agent/data_server/point_in_time.py tests/data_server/test_point_in_time.py
git commit -m "refactor: generalize filter_as_of to list[T] via a key extractor (#20)"
```

---

## Task 4: `ArchiveDerivedPlugin` ABC + `ConnectorRegistry` + `connectors.yaml` + import-linter

**Files:**
- Create: `src/forecasting_agent/data_server/connectors.py`
- Create: `src/forecasting_agent/data_server/connector_registry.py`
- Create: `src/forecasting_agent/data_server/connectors.yaml`
- Modify: `.importlinter`
- Create: `tests/data_server/test_connector_registry.py`

**Interfaces:**
- Produces: `ArchiveDerivedPlugin(ABC)` — `fetch(self, observed_on: date) -> list[Any]` (one method,
  mirrors #19's `Downloader` ABC's minimalism — no `symbol`/`supports`). `ConnectorRegistry` — same
  dotted-path-loading shape as `PluginRegistry._instantiate_plugin`, but keyed by connector name
  (`"flows"`, `"microstructure"`), not market code. `resolve(name: str) -> ArchiveDerivedPlugin`,
  `get_connector_registry()` module-level singleton (mirrors `get_registry()`).
- Consumed by Tasks 5/6 (the two connector classes subclass `ArchiveDerivedPlugin`) and Task 7
  (`server.py`'s new tools call `get_connector_registry().resolve(...)`).

**Seam note:** deliberately NOT sharing code with `PluginRegistry` — two call sites doesn't justify a
shared base per this project's YAGNI stance (spec decision 4). Copy the loading pattern, don't
abstract it.

**`ConnectorRegistry` must accept an optional `manifest_path` param, mirroring `PluginRegistry`'s
existing constructor exactly** — this is what lets this task's own test be self-contained (a temporary
manifest pointing at a stub plugin defined in the test file itself), rather than depending on Tasks
5/6's real connector modules to exist. Do not write a test here that imports
`forecasting_agent.data_server.plugins.flows`/`.microstructure` — those don't exist until Task 6.

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_connector_registry.py
from datetime import date

import pytest


def test_registry_resolves_a_connector_from_a_temporary_manifest(tmp_path):
    from forecasting_agent.data_server.connector_registry import ConnectorRegistry

    stub_module = tmp_path / "stub_connector.py"
    stub_module.write_text(
        "from datetime import date\n"
        "from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin\n\n"
        "class StubConnector(ArchiveDerivedPlugin):\n"
        "    def fetch(self, observed_on: date) -> list:\n"
        "        return ['stub']\n"
    )
    manifest = tmp_path / "test_connectors.yaml"
    manifest.write_text(f"stub: stub_connector\n")

    import sys
    sys.path.insert(0, str(tmp_path))
    try:
        registry = ConnectorRegistry(manifest_path=manifest)
        connector = registry.resolve("stub")
        assert connector.fetch(date(2026, 8, 14)) == ["stub"]
    finally:
        sys.path.remove(str(tmp_path))


def test_registry_raises_key_error_for_unknown_connector(tmp_path):
    from forecasting_agent.data_server.connector_registry import ConnectorRegistry

    manifest = tmp_path / "empty_connectors.yaml"
    manifest.write_text("{}\n")

    registry = ConnectorRegistry(manifest_path=manifest)

    with pytest.raises(KeyError):
        registry.resolve("not_a_real_connector")


def test_archive_derived_plugin_is_abstract_with_one_method():
    from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin

    class Concrete(ArchiveDerivedPlugin):
        def fetch(self, observed_on: date) -> list:
            return []

    instance = Concrete()
    assert instance.fetch(date(2026, 8, 14)) == []
```
This task is fully green on its own — no dependency on Tasks 5/6. The real-manifest resolution test
(`registry.resolve("flows")`/`"microstructure"` against the actual `connectors.yaml`) is added in
Task 6, once both connector modules genuinely exist to resolve.

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_connector_registry.py -v
```
Expected: `FAIL` — `ModuleNotFoundError` for `connector_registry`/`connectors`.

- [ ] **Step 3: Implement**

`connectors.py`: `ArchiveDerivedPlugin(ABC)` with `@abstractmethod fetch(self, observed_on: date) ->
list[Any]`. `connectors.yaml`:
```yaml
flows: forecasting_agent.data_server.plugins.flows
microstructure: forecasting_agent.data_server.plugins.microstructure
```
`connector_registry.py`: `ConnectorRegistry.__init__(self, manifest_path: Path | str | None = None)`
— `None` defaults to `Path(__file__).parent / "connectors.yaml"`, mirroring `PluginRegistry` exactly.
Loads the manifest (same YAML-parse pattern), `_instantiate_connector` (dotted-path import, find the
one `ArchiveDerivedPlugin` subclass in the module — same `_find_plugin_class` pattern, copied not
shared), `resolve(name) -> ArchiveDerivedPlugin` raising `KeyError` with the supported-list message
style `PluginRegistry.resolve` already uses. `.importlinter`: add the two contracts from the spec's
Structure section verbatim (`connector-flows-isolation`, `connector-microstructure-isolation`).

- [ ] **Step 4-6: Run, lint/typecheck/import-linter, commit**

```bash
uv run pytest tests/data_server/test_connector_registry.py -v
uv run ruff check src/forecasting_agent/data_server tests/data_server
uv run mypy src/forecasting_agent/data_server
git add src/forecasting_agent/data_server/connectors.py src/forecasting_agent/data_server/connector_registry.py src/forecasting_agent/data_server/connectors.yaml .importlinter tests/data_server/test_connector_registry.py
git commit -m "feat: add ArchiveDerivedPlugin ABC and ConnectorRegistry (#20)"
```

---

## Task 5: `flows.py` — parses `participant_oi` archive into `FlowRecord`

**Files:**
- Create: `src/forecasting_agent/data_server/plugins/flows.py`
- Create: `tests/data_server/test_flows_plugin.py`

**Interfaces:** Produces `FlowsPlugin(ArchiveDerivedPlugin)` — `fetch(observed_on) ->
list[FlowRecord]`. Reads via `ObservationStore(source="participant_oi").read(...)` (Task 2's
`ObservationStore`, #19's real class — import it, do not reimplement archive reading). Parses the CSV
shape confirmed in #19's own fixture (`tests/archive/fixtures/participant_oi_sample.csv` — read it
directly before writing the parser, the header row is the ground truth for column order).

**Seam note:** this plugin never writes to the archive (import-linter forbids importing
`archive.downloaders`) — read-only, parse-only, exactly #20's own AC.

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_flows_plugin.py
"""Tests FlowsPlugin parses the real archived participant-OI fixture into typed FlowRecord rows."""

from datetime import date
from unittest.mock import MagicMock, patch


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_parses_real_fixture_into_flow_records(mock_store_cls):
    from pathlib import Path
    from forecasting_agent.data_server.plugins.flows import FlowsPlugin

    fixture = (Path(__file__).parent.parent / "archive" / "fixtures" / "participant_oi_sample.csv").read_bytes()
    mock_store_cls.return_value.read.return_value = fixture

    records = FlowsPlugin().fetch(date(2026, 8, 14))

    assert len(records) == 5  # Client, DII, FII, Pro, TOTAL -- matches the real fixture's row count
    fii = next(r for r in records if r.participant == "FII")
    assert fii.total_long_contracts == 4358938  # exact value from the committed fixture


@patch("forecasting_agent.data_server.plugins.flows.ObservationStore")
def test_fetch_returns_empty_list_when_archive_has_no_data_for_the_date(mock_store_cls):
    from forecasting_agent.data_server.plugins.flows import FlowsPlugin

    mock_store_cls.return_value.read.return_value = None

    records = FlowsPlugin().fetch(date(2026, 1, 1))

    assert records == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_flows_plugin.py -v
```
Expected: `FAIL` — `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`FlowsPlugin(ArchiveDerivedPlugin).fetch(observed_on)`: `ObservationStore().read(source=
"participant_oi", observed_on=observed_on)` → `None` → return `[]`; otherwise parse the CSV bytes
(stdlib `csv.DictReader` over a decoded string) into `FlowRecord` instances, mapping the real header
names (`Client Type`, `Future Index Long`, etc. — read the actual fixture header, don't guess spacing)
to the Pydantic field names from Task 2. `participant` comes from the `Client Type` column verbatim.

- [ ] **Step 4-6: Run to pass, lint/typecheck/import-linter, commit**

```bash
uv run pytest tests/data_server/ -v
uv run ruff check src/forecasting_agent/data_server tests/data_server
uv run mypy src/forecasting_agent/data_server
uv run lint-imports
git add src/forecasting_agent/data_server/plugins/flows.py tests/data_server/test_flows_plugin.py
git commit -m "feat: add flows connector parsing participant-OI archive into FlowRecord (#20)"
```

---

## Task 6: `microstructure.py` — parses delivery/bulk/block archive sources into typed records

**Files:**
- Create: `src/forecasting_agent/data_server/plugins/microstructure.py`
- Create: `tests/data_server/test_microstructure_plugin.py`

**Interfaces:** Produces `MicrostructurePlugin(ArchiveDerivedPlugin)` — `fetch(observed_on) ->
MicrostructureResponse`. Reads three sources via `ObservationStore`: `"delivery_position"`,
`"bulk_deals"`, `"block_deals"`.

**Seam note:** a `NO RECORDS` bulk/block body (verified live — NSE's own literal string for "nothing
to report") must produce an empty list, not a parse error and not a `coverage_note` — that string is
routine, not an anomaly. Reserve `coverage_note` for genuinely missing archive data (the source was
never fetched, or a `gap` row), matching the spec's Error Handling section's absence-vs-failure split.
**Call `ObservationStore.read()` with keyword arguments (`source=..., observed_on=...`)** — the mock
in Step 1's test dispatches by keyword (`mock_store.read.side_effect = lambda source, observed_on:
...`); calling it positionally will raise `TypeError` for a reason unrelated to the parser itself, and
that failure would be easy to misdiagnose as a parsing bug.

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_microstructure_plugin.py
"""Tests MicrostructurePlugin parses delivery/bulk/block archive sources, distinguishing real absence from a routine NO RECORDS day."""

from datetime import date
from unittest.mock import MagicMock, patch


@patch("forecasting_agent.data_server.plugins.microstructure.ObservationStore")
def test_fetch_parses_all_three_sources_when_present(mock_store_cls):
    delivery_fixture = b"Security Wise Delivery Position - Compulsory Rolling Settlement\n10,MTO,14082026,1636546147,0003186\nTrade Date <14-AUG-2026>,Settlement Type <N>\nRecord Type,Sr No,Name of Security,Series,Quantity Traded,Deliverable Quantity(gross across client level),% of Deliverable Quantity to Traded Quantity\n20,1,RELIANCE,EQ,1000,600,60.00\n"
    bulk_fixture = b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks\n14-AUG-2026,AGIIL,Agi Infra Limited,ARIHANT CAPITAL,BUY,841254,302.04,-\n"
    block_fixture = b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price\nNO RECORDS,,,,,,\n"

    mock_store = mock_store_cls.return_value
    mock_store.read.side_effect = lambda source, observed_on: {
        "delivery_position": delivery_fixture, "bulk_deals": bulk_fixture, "block_deals": block_fixture,
    }[source]

    from forecasting_agent.data_server.plugins.microstructure import MicrostructurePlugin
    resp = MicrostructurePlugin().fetch(date(2026, 8, 14))

    assert len(resp.delivery) == 1
    assert resp.delivery[0].delivery_pct == 60.00
    assert len(resp.bulk_deals) == 1
    assert resp.bulk_deals[0].symbol == "AGIIL"
    assert resp.block_deals == []  # NO RECORDS -- empty list, not an error, not a coverage_note
    assert resp.coverage_note is None


@patch("forecasting_agent.data_server.plugins.microstructure.ObservationStore")
def test_fetch_sets_coverage_note_when_a_source_was_never_archived(mock_store_cls):
    mock_store = mock_store_cls.return_value
    mock_store.read.return_value = None

    from forecasting_agent.data_server.plugins.microstructure import MicrostructurePlugin
    resp = MicrostructurePlugin().fetch(date(2020, 1, 1))

    assert resp.delivery == []
    assert resp.bulk_deals == []
    assert resp.block_deals == []
    assert resp.coverage_note is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_microstructure_plugin.py -v
```
Expected: `FAIL` — `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`MicrostructurePlugin.fetch(observed_on)`: read all three sources via `ObservationStore`. For each
`None` result, note it (accumulate into a `coverage_note` string listing which sources were absent —
only set if at least one is genuinely absent). Parse delivery bytes (skip the two header rows, then
`csv.DictReader` from the `Record Type,...` line — a real fixed structure, verified live). Parse
bulk/block CSV normally; if the body is literally `NO RECORDS` in the `Date` column of the first data
row, return an empty list for that source, no note.

- [ ] **Step 4: Add the real-manifest resolution test, now that both connectors genuinely exist**

Append to `tests/data_server/test_connector_registry.py` (this file already exists from Task 4 — add
to it, don't replace it):
```python
def test_registry_resolves_flows_and_microstructure_from_the_real_manifest():
    from forecasting_agent.data_server.connector_registry import ConnectorRegistry

    registry = ConnectorRegistry()

    assert registry.resolve("flows") is not None
    assert registry.resolve("microstructure") is not None
```
This uses the real, default `connectors.yaml` (no `manifest_path` override) — it can only pass now
that both `plugins/flows.py` and `plugins/microstructure.py` genuinely exist on disk.

- [ ] **Step 5-6: Run to pass, lint/typecheck/import-linter, commit**

```bash
uv run pytest tests/data_server/ -v
uv run ruff check src/forecasting_agent/data_server tests/data_server
uv run mypy src/forecasting_agent/data_server
uv run lint-imports
git add src/forecasting_agent/data_server/plugins/microstructure.py tests/data_server/test_microstructure_plugin.py tests/data_server/test_connector_registry.py
git commit -m "feat: add microstructure connector parsing delivery/bulk/block archive sources (#20)"
```

---

## Task 7: `fetch_flows` / `fetch_microstructure` MCP tools in `server.py`

**Files:**
- Modify: `src/forecasting_agent/data_server/server.py`
- Create: `tests/data_server/test_flows_microstructure_tools.py`

**Interfaces:** Produces two new `@app.tool()` functions: `fetch_flows(observed_on: str, as_of: str |
None = None) -> FlowsResponse`, `fetch_microstructure(observed_on: str, as_of: str | None = None) ->
MicrostructureResponse`. No downstream task in this plan consumes these — they're #20's MCP-facing
deliverable.

**Seam note:** both tools resolve their connector via `get_connector_registry().resolve(...)`, call
`.fetch(observed_on)`, then apply Task 3's generalized `filter_as_of` with the `key=lambda r:
r.observed_on` extractor — `as_of` filtering is not optional, it's #20's own AC #9.

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_flows_microstructure_tools.py
"""Tests fetch_flows/fetch_microstructure MCP tools resolve via ConnectorRegistry and apply as_of filtering."""

from datetime import date
from unittest.mock import MagicMock, patch


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_flows_applies_as_of_filtering(mock_get_registry):
    from forecasting_agent.data_server.contracts import FlowRecord
    from forecasting_agent.data_server.server import fetch_flows

    record = FlowRecord(
        observed_on=date(2026, 8, 10), participant="FII",
        future_index_long=1, future_index_short=0, future_stock_long=0, future_stock_short=0,
        option_index_call_long=0, option_index_put_long=0, option_index_call_short=0,
        option_index_put_short=0, option_stock_call_long=0, option_stock_put_long=0,
        option_stock_call_short=0, option_stock_put_short=0,
        total_long_contracts=1, total_short_contracts=0,
    )
    mock_connector = MagicMock()
    mock_connector.fetch.return_value = [record]
    mock_get_registry.return_value.resolve.return_value = mock_connector

    result = fetch_flows(observed_on="2026-08-10", as_of="2026-08-10")

    assert len(result.records) == 1
    mock_get_registry.return_value.resolve.assert_called_once_with("flows")


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_flows_leakage_error_propagates_for_future_as_of(mock_get_registry):
    from forecasting_agent.data_server.point_in_time import LeakageError
    from forecasting_agent.data_server.server import fetch_flows
    import pytest

    mock_get_registry.return_value.resolve.return_value.fetch.return_value = []

    with pytest.raises(LeakageError):
        fetch_flows(observed_on="2026-08-10", as_of="2099-01-01")


@patch("forecasting_agent.data_server.server.get_connector_registry")
def test_fetch_microstructure_calls_the_microstructure_connector(mock_get_registry):
    from forecasting_agent.data_server.contracts import MicrostructureResponse
    from forecasting_agent.data_server.server import fetch_microstructure

    mock_get_registry.return_value.resolve.return_value.fetch.return_value = MicrostructureResponse(
        observed_on=date(2026, 8, 10)
    )

    fetch_microstructure(observed_on="2026-08-10")

    mock_get_registry.return_value.resolve.assert_called_once_with("microstructure")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_flows_microstructure_tools.py -v
```
Expected: `FAIL` — `ImportError`, the two tools don't exist in `server.py` yet.

- [ ] **Step 3: Implement**

Add near the top of `server.py`: `from forecasting_agent.data_server.connector_registry import
get_connector_registry`, `from forecasting_agent.data_server.contracts import FlowsResponse,
MicrostructureResponse`, `from forecasting_agent.data_server.point_in_time import filter_as_of`.

```python
@app.tool()
def fetch_flows(observed_on: str, as_of: str | None = None) -> FlowsResponse:
    """Fetch participant-wise F&O open interest flow records for a given date."""
    connector = get_connector_registry().resolve("flows")
    obs_date = date.fromisoformat(observed_on)
    records = connector.fetch(obs_date)
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    filtered = filter_as_of(records, as_of=as_of_date, key=lambda r: r.observed_on)
    return FlowsResponse(observed_on=obs_date, records=filtered)


@app.tool()
def fetch_microstructure(observed_on: str, as_of: str | None = None) -> MicrostructureResponse:
    """Fetch delivery percentage and bulk/block deal records for a given date."""
    connector = get_connector_registry().resolve("microstructure")
    obs_date = date.fromisoformat(observed_on)
    response = connector.fetch(obs_date)
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    response.delivery = filter_as_of(response.delivery, as_of=as_of_date, key=lambda r: r.observed_on)
    response.bulk_deals = filter_as_of(response.bulk_deals, as_of=as_of_date, key=lambda r: r.observed_on)
    response.block_deals = filter_as_of(response.block_deals, as_of=as_of_date, key=lambda r: r.observed_on)
    return response
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/data_server/ -v
```
Expected: `PASS`, full directory, including every pre-existing `fetch_ohlcv`/`fetch_option_chain` test
— the strongest proof this task didn't regress anything.

- [ ] **Step 5: Full regression + lint/typecheck/import-linter**

```bash
uv run pytest tests/ -v
uv run ruff check src/forecasting_agent
uv run mypy src/forecasting_agent
uv run lint-imports
```

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/data_server/server.py tests/data_server/test_flows_microstructure_tools.py
git commit -m "feat: add fetch_flows and fetch_microstructure MCP tools (#20)"
```

---

## Gemini Delegation Prompts

One task at a time, strict order 1→7 (each depends on the previous). Preamble, identical shape to
#19's:

```
You are implementing one task from docs/superpowers/plans/2026-08-17-indian-moat-connectors-plan.md
in the Forecasting_Agent repo, GitHub issue #20. Work in this exact directory (a git worktree already
on the correct branch, feat/issue-19-20-observation-archive-and-connectors — do not create a new
worktree, do not switch branches). Python 3.12, uv, pytest, ruff, mypy. Follow the task's steps
exactly: use the failing test given verbatim, run it, confirm it fails for the stated reason,
implement the minimal code to pass, run it again, confirm it passes, run the lint/typecheck/
import-linter commands listed (always the whole tests/data_server/ or tests/archive/ directory, not
just the new file, per the task's own instructions), then commit with the exact message given. Every
new file needs a one-line top-of-file abstract comment and one-line input/output comments on every
exported function/class (no docstrings). Do not modify files outside this task's Files list. Do not
push. Do not touch the Obsidian vault. Do not run a final smoke test. Report the actual test output
and lint/typecheck output verbatim, not a summary claim.
```

## Validator Brief (run inline after each task, cold, never trusting the self-report)

1. Re-run the task's exact test command yourself.
2. `uv run ruff check . && uv run mypy src/forecasting_agent` — read actual output.
3. `git status`/`git diff` — only declared Files touched, no scope creep.
4. Task-specific:
   - **Task 1:** confirm the bulk/block adapter really never raises on a `NO RECORDS` body — read the
     implementation, don't trust the test alone.
   - **Task 3 — highest scrutiny.** This is the task most likely to silently break `fetch_ohlcv`. Run
     `uv run pytest tests/data_server/test_point_in_time.py tests/data_server/ -v` yourself and read
     every pre-existing test's result individually, not just the aggregate pass count. Read the actual
     diff — confirm `fetch_ohlcv`'s call site in `server.py` was NOT touched.
   - **Task 4:** expected partial failures until Task 6 — confirm the failure reason is exactly
     "module doesn't exist yet," not something else.
   - **Task 5:** manually verify the parsed `FlowRecord` values against the real fixture file by eye —
     don't just trust the test's hardcoded expected number.
   - **Task 6:** confirm the `NO RECORDS` case truly returns `[]` and not a parse exception by reading
     the code path, not just the test.
   - **Task 7:** run the FULL suite (`uv run pytest tests/ -v`) and confirm the count is strictly
     higher than #19's final 157, with zero new failures — this task is the integration point where a
     regression in `fetch_ohlcv` would first become visible.

---

## Smoke Test (Claude runs this after all 7 tasks are verified — NOT delegated to Gemini)

1. `uv run python -m forecasting_agent.archive.run_daily` — confirm all 6 sources attempt (3 original
   + 3 new), read the real log output.
2. Check `SELECT source, status FROM observation_archive WHERE observed_on = <today>` — confirm
   `delivery_position`/`bulk_deals`/`block_deals` rows exist (gap or ok).
3. Call `fetch_flows` and `fetch_microstructure` directly against whatever the archive now holds —
   confirm real typed output, not an exception, even on a `gap`-heavy day.
4. Call `fetch_ohlcv` once more for a real symbol — confirm it still works identically to #19's own
   smoke test, proving Task 3's generalization didn't regress it.

## Obsidian Sync (Claude runs this after the smoke test — NOT delegated to Gemini)

Same three files as #19's sync: Daily note, Kanban (#20 → Done, note #32 filed and parked), hub
checklist.
