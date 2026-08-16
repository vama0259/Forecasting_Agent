# Point-in-Time Observation Archive (#19) — Implementation Plan

> **For agentic workers:** implementation goes to Gemini via `agy` (`gemini-delegated-implementation`),
> one task at a time, verified inline after each task — not executed by this plan's author directly.

**Goal:** Build `src/forecasting_agent/archive/`: a raw, append-only, byte-level archive of NSE
bhavcopy + participant-wise F&O open interest, plus a hook that snapshots as-observed OHLCV bars.

**Spec:** `docs/superpowers/specs/2026-08-16-point-in-time-observation-archive-design.md`
(two independent `APPROVED` rounds, R7+R8 — read decisions 1-8 before touching any task; this plan
cites file/line seams, it does not restate the design).

**Branch / worktree:** `feat/issue-19-20-observation-archive-and-connectors`, in
`.claude/worktrees/feat+issue-19-20-archive-connectors/` — Gemini should run **in this directory**,
not the main repo checkout.

## Delegation Boundary (read this before sending anything to Antigravity/Gemini)

**Antigravity/Gemini's job is Tasks 1-5 only — implementation, nothing else.** It must NOT:
- Sync or write to the Obsidian vault (`/home/varunmalhotra/Desktop/Knowledge`) in any way.
- Run or report on a final end-to-end smoke test — that happens after all 5 tasks are verified, done by
  Claude, not by Gemini.
- Push, open a PR, or merge anything.
- Touch any file outside a task's declared `Files:` list.

The **Smoke Test** and **Obsidian Sync** sections at the very end of this plan are explicitly **Claude's
responsibility, run after all 5 tasks are verified** — not part of any Gemini delegation prompt.

## Global Constraints

- Every new file: one-line top-of-file abstract comment. Every function/class: one-line input/output
  comment. No multi-line docstrings (CLAUDE.md hard rule).
- `uv run ruff check . && uv run ruff format --check . && uv run mypy src/forecasting_agent/archive` must
  pass after every task.
- Postgres is real, not mocked, for `store.py` tests: `docker exec forecasting_agent-postgres-1 psql -U
  harness -d harness` — the container is already running (`docker ps` confirms
  `forecasting_agent-postgres-1`, healthy). No mocked-DB tests substitute for this per CLAUDE.md's
  documented Gemini quality gap (mocked-green has repeatedly diverged from real-system behavior on this
  project).
- Task order is a hard dependency chain: 1 → 2 → 3 → 4 → 5 (each later task imports the previous task's
  module).
- No task pushes, opens a PR, or touches the Obsidian vault — that happens after all tasks are verified,
  on explicit go-ahead.

---

## Task 1: Apply migration 003 to the real database

**This task has no files to create or modify — everything is already written and committed**
(commit `8c506f5`: migration SQL, `.gitignore`, `.importlinter` with the two archive-downloader
contracts, `pyproject.toml`'s `psycopg`/`httpx` changes, `uv sync` already run). **Do not `git add`
or commit anything in this task** — there is nothing new to commit; the only remaining action is a
one-time database operation plus a verification command.

**Interfaces:** Produces the schema `observation_archive` (id, source, observed_on, retrieved_at, uri,
sha256, bytes_len, status, detail) with two partial unique indexes — consumed by Task 2's `store.py`.

**Already committed, for reference (do not regenerate):**

`harness/src/storage/migrations/003_observation_archive.sql`:
```sql
CREATE TABLE IF NOT EXISTS observation_archive (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  observed_on date NOT NULL,
  retrieved_at timestamptz NOT NULL,
  uri text,
  sha256 text,
  bytes_len int,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'gap')),
  detail text
);
CREATE UNIQUE INDEX idx_obs_archive_ok  ON observation_archive (source, observed_on, sha256) WHERE status = 'ok';
CREATE UNIQUE INDEX idx_obs_archive_gap ON observation_archive (source, observed_on)          WHERE status = 'gap';
CREATE INDEX idx_obs_archive_lookup ON observation_archive (source, observed_on, retrieved_at DESC);
```

`.importlinter` additions (two non-self-referencing contracts, verified against a real `lint-imports`
run with injected violations in this session — do not collapse into one contract with both downloaders
in both `source_modules` and `forbidden_modules`):
```
[importlinter:contract:archive-downloader-bhavcopy-isolation]
name = Archive bhavcopy downloader isolation
type = forbidden
source_modules =
    forecasting_agent.archive.downloaders.nse_bhavcopy
forbidden_modules =
    forecasting_agent.archive.store
    forecasting_agent.archive.downloaders.nse_participant_oi
    forecasting_agent.data_server

[importlinter:contract:archive-downloader-participant-oi-isolation]
name = Archive participant OI downloader isolation
type = forbidden
source_modules =
    forecasting_agent.archive.downloaders.nse_participant_oi
forbidden_modules =
    forecasting_agent.archive.store
    forecasting_agent.archive.downloaders.nse_bhavcopy
    forecasting_agent.data_server
```

`pyproject.toml`: `dependencies` now includes `"httpx>=0.28.0"` and `"psycopg[binary]>=3.2"`; the `dev`
group's `httpx>=0.28.0` entry was removed (promoted, not duplicated). `uv sync` has already been run —
`psycopg==3.3.4` / `psycopg-binary==3.3.4` are installed.

- [ ] **Step 1: Apply migration 003 to the real database** (not yet applied)

```bash
docker exec -i forecasting_agent-postgres-1 psql -U harness -d harness -v ON_ERROR_STOP=1 <<'EOF'
BEGIN;
CREATE TABLE IF NOT EXISTS observation_archive (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  observed_on date NOT NULL,
  retrieved_at timestamptz NOT NULL,
  uri text,
  sha256 text,
  bytes_len int,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'gap')),
  detail text
);
CREATE UNIQUE INDEX idx_obs_archive_ok  ON observation_archive (source, observed_on, sha256) WHERE status = 'ok';
CREATE UNIQUE INDEX idx_obs_archive_gap ON observation_archive (source, observed_on)          WHERE status = 'gap';
CREATE INDEX idx_obs_archive_lookup ON observation_archive (source, observed_on, retrieved_at DESC);
INSERT INTO schema_migrations (name) VALUES ('003_observation_archive.sql');
COMMIT;
EOF
```
This mirrors exactly what `harness/src/storage/migrator.ts`'s `runMigrations()` does (transaction, then
record in `schema_migrations`) — there is no CLI wrapper script for the TS migrator (checked
`harness/package.json`, no `migrate` script exists), so this hand-run is the correct substitute for a
one-off local apply. Confirm with:
```bash
docker exec -i forecasting_agent-postgres-1 psql -U harness -d harness -c "SELECT name FROM schema_migrations ORDER BY name;"
```
Expected: `001_initial.sql`, `002_memory_tiers.sql`, `003_observation_archive.sql`.

- [ ] **Step 2: Verify import-linter**

```bash
uv run lint-imports
```
Expected: all contracts `KEPT`, including `Archive bhavcopy downloader isolation` and `Archive
participant OI downloader isolation` (these will show `KEPT` trivially until Task 3 creates the
downloader files — that's fine, an absent source module is not a violation).

This task is done once Steps 1-2 pass — no commit, nothing else to do. Move to Task 2.

---

## Task 2: `archive/store.py` — `ObservationStore`

**Files:**
- Create: `src/forecasting_agent/archive/__init__.py` (empty, package marker)
- Create: `src/forecasting_agent/archive/store.py`
- Create: `src/forecasting_agent/archive/errors.py` (`ArchiveWriteError` — Task 3 later *modifies* this
  same file to add `SourceUnavailableError` alongside it; Task 2 creates the file first)
- Test: `tests/archive/test_store.py`

**Interfaces:**
- Consumes: `STORAGE_CONNECTION_STRING` env var (already set in `harness/.env`, read via
  `os.environ["STORAGE_CONNECTION_STRING"]`), `psycopg` (sync connection, no pool — spec decision 2).
- Produces:
  ```python
  @dataclass(frozen=True)
  class ObservationRecord:
      id: str
      source: str
      observed_on: date
      retrieved_at: datetime
      uri: str | None
      sha256: str | None
      bytes_len: int | None
      status: str  # 'ok' | 'gap'
      detail: str | None


  class ObservationStore:
      def __init__(self, archive_dir: str = "data/archive", connection_string: str | None = None) -> None: ...
      def write(
          self,
          source: str,
          observed_on: date,
          content: bytes | None,
          retrieved_at: datetime | None = None,
          detail: str | None = None,
      ) -> None: ...
      def read(self, source: str, observed_on: date) -> bytes | None: ...
      def read_history(self, source: str, observed_on: date) -> list[ObservationRecord]: ...
  ```
  Consumed by Task 3 (nothing — downloaders never touch the store, per the corrected import-linter
  contract), Task 4 (`run_daily.py` calls `write()`), Task 5 (the OHLCV hook calls `write()`).

**Seam note:** `write()` is the *only* place bytes touch the filesystem or the DB — this is what makes
the import-linter contract in Task 1 meaningful (downloaders literally cannot write). `content=None`
means "confirmed absent" (a gap), not "unknown" — callers must be deliberate about passing `None`.

- [ ] **Step 1: Write the failing test**

```python
# tests/archive/test_store.py
"""Tests for ObservationStore: append-only writes, idempotency, restatement, and gap semantics against real Postgres."""

import hashlib
import os
import time
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from forecasting_agent.archive.store import ObservationStore

pytestmark = pytest.mark.integration

CONN_STRING = os.environ.get("STORAGE_CONNECTION_STRING", "postgresql://harness:harness@localhost:5432/harness")


@pytest.fixture
def store(tmp_path: Path) -> ObservationStore:
    """Takes a pytest tmp_path; returns a fresh ObservationStore rooted there, with its rows cleared after the test."""
    s = ObservationStore(archive_dir=str(tmp_path), connection_string=CONN_STRING)
    yield s
    with s._connect() as conn:  # noqa: SLF001 -- test-only cleanup, not part of the public seam
        conn.execute("DELETE FROM observation_archive WHERE source LIKE 'test_%'")
        conn.commit()


def test_write_identical_bytes_twice_yields_one_row_and_no_rewritten_file(store: ObservationStore, tmp_path: Path):
    content = b"identical bytes"
    store.write(source="test_identical", observed_on=date(2026, 1, 5), content=content)
    sha = hashlib.sha256(content).hexdigest()
    file_path = tmp_path / "test_identical" / f"{sha}.bin"
    assert file_path.exists()
    mtime_1 = file_path.stat().st_mtime
    time.sleep(0.05)

    store.write(source="test_identical", observed_on=date(2026, 1, 5), content=content)

    assert file_path.stat().st_mtime == mtime_1
    history = store.read_history(source="test_identical", observed_on=date(2026, 1, 5))
    assert len(history) == 1


def test_write_different_bytes_same_date_yields_second_row_neither_overwritten(store: ObservationStore, tmp_path: Path):
    store.write(source="test_restate", observed_on=date(2026, 1, 6), content=b"version one")
    store.write(source="test_restate", observed_on=date(2026, 1, 6), content=b"version two")

    history = store.read_history(source="test_restate", observed_on=date(2026, 1, 6))
    assert len(history) == 2
    assert {h.status for h in history} == {"ok"}
    sha1 = hashlib.sha256(b"version one").hexdigest()
    sha2 = hashlib.sha256(b"version two").hexdigest()
    assert (tmp_path / "test_restate" / f"{sha1}.bin").read_bytes() == b"version one"
    assert (tmp_path / "test_restate" / f"{sha2}.bin").read_bytes() == b"version two"


def test_read_returns_most_recent_ok_row(store: ObservationStore):
    store.write(
        source="test_recency",
        observed_on=date(2026, 1, 7),
        content=b"old",
        retrieved_at=datetime(2026, 1, 7, 9, 0, tzinfo=UTC),
    )
    store.write(
        source="test_recency",
        observed_on=date(2026, 1, 7),
        content=b"new",
        retrieved_at=datetime(2026, 1, 7, 18, 0, tzinfo=UTC),
    )

    assert store.read(source="test_recency", observed_on=date(2026, 1, 7)) == b"new"


def test_read_history_returns_all_rows_in_retrieved_at_order(store: ObservationStore):
    store.write(
        source="test_history",
        observed_on=date(2026, 1, 8),
        content=b"a",
        retrieved_at=datetime(2026, 1, 8, 9, 0, tzinfo=UTC),
    )
    store.write(
        source="test_history",
        observed_on=date(2026, 1, 8),
        content=b"b",
        retrieved_at=datetime(2026, 1, 8, 10, 0, tzinfo=UTC),
    )

    history = store.read_history(source="test_history", observed_on=date(2026, 1, 8))
    assert [h.retrieved_at for h in history] == sorted(h.retrieved_at for h in history)


def test_gap_row_untouched_by_later_successful_write(store: ObservationStore):
    store.write(source="test_gap_heal", observed_on=date(2026, 1, 9), content=None, detail="404 not found")
    store.write(source="test_gap_heal", observed_on=date(2026, 1, 9), content=b"finally arrived")

    history = store.read_history(source="test_gap_heal", observed_on=date(2026, 1, 9))
    statuses = sorted(h.status for h in history)
    assert statuses == ["gap", "ok"]
    gap_row = next(h for h in history if h.status == "gap")
    assert gap_row.detail == "404 not found"


def test_repeated_gap_writes_do_not_duplicate(store: ObservationStore):
    store.write(source="test_gap_dup", observed_on=date(2026, 1, 10), content=None, detail="404 not found")
    store.write(source="test_gap_dup", observed_on=date(2026, 1, 10), content=None, detail="404 not found")

    history = store.read_history(source="test_gap_dup", observed_on=date(2026, 1, 10))
    assert len(history) == 1


def test_source_with_slash_is_sanitized_to_a_flat_path(store: ObservationStore, tmp_path: Path):
    content = b"ohlcv bytes"
    store.write(source="ohlcv:NSE:RELIANCE/BSE", observed_on=date(2026, 1, 11), content=content)

    sha = hashlib.sha256(content).hexdigest()
    assert not (tmp_path / "ohlcv:NSE:RELIANCE" / "BSE").exists()
    sanitized_dir = tmp_path / "ohlcv:NSE:RELIANCE_BSE"
    assert (sanitized_dir / f"{sha}.bin").exists()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/archive/test_store.py -v
```
Expected: `FAIL` — `ModuleNotFoundError: No module named 'forecasting_agent.archive'` (module doesn't
exist yet).

- [ ] **Step 3: Implement `store.py`**

Requirements the implementation must satisfy (do not paraphrase around these — they come from the
spec's decisions 1-3 and the R5/R6/R7/R8 fixes, verified empirically in this session):
1. `errors.py`: `class ArchiveWriteError(Exception): pass` — raised by `write()` only when the filesystem
   write succeeds but the index insert fails (spec's Error Handling section; the file-then-index
   ordering means this is the only failure mode that can leave state inconsistent — a failed file write
   raises the underlying `OSError` directly, no wrapping needed).
2. `write()`: compute `sha256 = hashlib.sha256(content).hexdigest()` when `content is not None`;
   `status = 'ok'` if `content is not None` else `'gap'`. **Write file before index row** (spec decision
   1's crash-safety ordering) — `Path(archive_dir) / sanitize(source) / f"{sha256}.bin"`, using
   `Path.write_bytes` only if the file does not already exist (this is what makes the mtime-unchanged
   test pass — do not always rewrite). Sanitize `source` for the directory name via
   `source.replace("/", "_")`, mirroring `ParquetCache._get_file_path` in `data_server/cache.py` — the
   *stored* `source` column value stays unsanitized (original string), only the on-disk directory name
   is sanitized. **`uri` column value: the file path** (`str(Path(archive_dir) / sanitized_source /
   f"{sha256}.bin")`) — this is what lets `read()` locate the bytes later; a `gap` row's `uri` is `None`
   since no file was written. Wrap the index-insert step in `try/except`; on any DB exception after a
   successful file write, raise `ArchiveWriteError` from it (chain with `raise ... from exc`).
3. Index insert: `INSERT INTO observation_archive (...) VALUES (...) ON CONFLICT DO NOTHING RETURNING
   id` — **bare `ON CONFLICT`, no target list.** Verified empirically against real Postgres in this
   session (5-insert sequence, exact expected 3-row result) — do not add an explicit conflict target,
   it will raise `UniqueViolation` on a duplicate `gap` row.
4. `retrieved_at` defaults to `datetime.now(UTC)` if not passed.
5. `read()`: `SELECT uri FROM observation_archive WHERE source = %s AND observed_on = %s AND
   status = 'ok' ORDER BY retrieved_at DESC LIMIT 1`, then `Path(uri).read_bytes()`; `None`
   if no row.
6. `read_history()`: `SELECT * FROM observation_archive WHERE source = %s AND observed_on = %s ORDER BY
   retrieved_at ASC`, mapped to `ObservationRecord`.
7. One short-lived `psycopg.connect()` per call (no pool) — expose a `_connect()` helper the test fixture
   uses for cleanup, not a public API.
8. File header + function comments per CLAUDE.md's one-line-abstract rule.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/archive/test_store.py -v
```
Expected: `PASS` (7/7).

- [ ] **Step 5: Lint/typecheck**

```bash
uv run ruff check src/forecasting_agent/archive tests/archive
uv run mypy src/forecasting_agent/archive
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/archive/__init__.py src/forecasting_agent/archive/store.py src/forecasting_agent/archive/errors.py tests/archive/test_store.py tests/archive/__init__.py
git commit -m "feat: add ObservationStore append-only archive writer (#19)"
```

---

## Task 3: `archive/downloaders/` — `base.py`, `nse_bhavcopy.py`, `nse_participant_oi.py`

**Files:**
- Create: `src/forecasting_agent/archive/downloaders/__init__.py`
- Create: `src/forecasting_agent/archive/downloaders/base.py`
- Create: `src/forecasting_agent/archive/downloaders/nse_bhavcopy.py`
- Create: `src/forecasting_agent/archive/downloaders/nse_participant_oi.py`
- Modify: `src/forecasting_agent/archive/errors.py` (Task 2 already created this file with
  `ArchiveWriteError` — add `SourceUnavailableError` alongside it, do not overwrite the existing class)
- Create fixtures: `tests/archive/fixtures/participant_oi_sample.csv`, `tests/archive/fixtures/bhavcopy_cm_sample.csv`
  (small real content — participant OI is <1KB; a short real CSV snippet is fine, does not need to be the
  full file, only needs to be genuine bytes from a real response, not synthesized from imagination)
- Test: `tests/archive/test_downloaders.py`

**Interfaces:**
- Produces:
  ```python
  # base.py
  class Downloader(ABC):
      @abstractmethod
      def fetch_raw(self, observed_on: date) -> bytes: ...  # raises SourceUnavailableError on confirmed 404


  # nse_bhavcopy.py
  class NseBhavcopyDownloader(Downloader):
      def __init__(self, segment: str) -> None: ...  # segment: "CM" or "FO"
      def fetch_raw(self, observed_on: date) -> bytes: ...  # tries UDiFF URL, falls back to legacy URL on 404


  # nse_participant_oi.py
  class NseParticipantOiDownloader(Downloader):
      def fetch_raw(self, observed_on: date) -> bytes: ...
  ```
  Consumed by Task 4's `run_daily.py`. **Imports stdlib + `httpx` only** — never `archive.store`, never
  each other (Task 1's import-linter contracts enforce this).

**Seam note:** `Downloader.fetch_raw(observed_on) -> bytes` is the entire seam — one method, one input,
one output. This is deliberately small so #20's connectors (which read from the *archive*, not these
downloaders) never need to know this interface exists.

- [ ] **Step 1: Write the failing test**

```python
# tests/archive/test_downloaders.py
"""Tests for archive downloaders: retry/backoff schedule, 404-as-gap, and UDiFF-then-legacy fallback, against mocked httpx."""

from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from forecasting_agent.archive.downloaders.nse_bhavcopy import NseBhavcopyDownloader
from forecasting_agent.archive.downloaders.nse_participant_oi import NseParticipantOiDownloader
from forecasting_agent.archive.errors import SourceUnavailableError

FIXTURES = Path(__file__).parent / "fixtures"


def _response(status_code: int, content: bytes = b"") -> httpx.Response:
    return httpx.Response(status_code=status_code, content=content, request=httpx.Request("GET", "https://x"))


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_participant_oi_200_returns_bytes(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "participant_oi_sample.csv").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseParticipantOiDownloader().fetch_raw(date(2026, 8, 14))

    assert result == fixture_bytes
    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_participant_oi_404_raises_immediately_no_retry(mock_get: MagicMock):
    mock_get.return_value = _response(404)

    with pytest.raises(SourceUnavailableError):
        NseParticipantOiDownloader().fetch_raw(date(2026, 8, 15))

    assert mock_get.call_count == 1


@patch("forecasting_agent.archive.downloaders.nse_participant_oi.httpx.get")
def test_transport_failure_retries_exactly_3_times_total_then_raises(mock_get: MagicMock):
    mock_get.side_effect = httpx.ConnectError("connection reset")

    with pytest.raises(httpx.ConnectError):
        NseParticipantOiDownloader().fetch_raw(date(2026, 8, 14))

    assert mock_get.call_count == 3


@patch("forecasting_agent.archive.downloaders.nse_bhavcopy.httpx.get")
def test_bhavcopy_udiff_404_falls_back_to_legacy_200(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "bhavcopy_cm_sample.csv").read_bytes()
    mock_get.side_effect = [_response(404), _response(200, fixture_bytes)]

    result = NseBhavcopyDownloader(segment="CM").fetch_raw(date(2015, 1, 5))

    assert result == fixture_bytes
    assert mock_get.call_count == 2
    first_url = mock_get.call_args_list[0].args[0]
    second_url = mock_get.call_args_list[1].args[0]
    assert "nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM" in first_url
    assert "nsearchives.nseindia.com/content/historical/EQUITIES" in second_url


@patch("forecasting_agent.archive.downloaders.nse_bhavcopy.httpx.get")
def test_bhavcopy_udiff_200_does_not_try_legacy(mock_get: MagicMock):
    fixture_bytes = (FIXTURES / "bhavcopy_cm_sample.csv").read_bytes()
    mock_get.return_value = _response(200, fixture_bytes)

    result = NseBhavcopyDownloader(segment="CM").fetch_raw(date(2026, 8, 14))

    assert result == fixture_bytes
    assert mock_get.call_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/archive/test_downloaders.py -v
```
Expected: `FAIL` — `ModuleNotFoundError`.

Note: **create the two fixture files first** (`tests/archive/fixtures/participant_oi_sample.csv`,
`tests/archive/fixtures/bhavcopy_cm_sample.csv`) with real content — small snippets are fine, but they
must be genuine bytes, not invented. The spec's live-verified URLs (decisions 4-5) are the source; if
Gemini cannot reach the live NSE endpoints from its sandbox, use a plausible real-shaped CSV header +
2-3 data rows matching the schemas named in spec decision 4 (UDiFF: `TradDt,BizDt,Sgmt,...`; legacy:
`SYMBOL,SERIES,OPEN,...`; participant OI: whatever columns `archives.nseindia.com/content/nsccl/
fao_participant_oi_*.csv` actually serves) and flag in the validator brief that these are
sandbox-approximated, not live-captured, so the human can swap in real captures later.

- [ ] **Step 3: Implement**

Requirements:
1. `errors.py`: **append** `class SourceUnavailableError(Exception): pass` to the existing file (it
   already has `ArchiveWriteError` from Task 2 — do not remove or overwrite that class).
2. `base.py`: `Downloader(ABC)` with `fetch_raw(self, observed_on: date) -> bytes`. Imports only
   `abc`, `datetime`.
3. Retry/backoff, hand-rolled per spec's Tooling section (no new dependency): 3 attempts total, `base=2`
   doubling backoff (`time.sleep(2)` before attempt 2, `time.sleep(4)` before attempt 3), applied only
   to transport failures (`httpx.TransportError` and subclasses, or a 5xx status) — never to a 404,
   which raises `SourceUnavailableError` immediately on the first attempt.
4. `nse_participant_oi.py`: single URL,
   `https://archives.nseindia.com/content/nsccl/fao_participant_oi_{observed_on:%d%m%Y}.csv`, browser
   `User-Agent` header, no cookies (spec decision 6).
5. `nse_bhavcopy.py`: `segment` param `"CM"` or `"FO"`. UDiFF URL:
   `https://nsearchives.nseindia.com/content/{cm|fo}/BhavCopy_NSE_{CM|FO}_0_0_0_{observed_on:%Y%m%d}_F_0000.csv.zip`.
   Legacy URL: `https://nsearchives.nseindia.com/content/historical/EQUITIES/{observed_on:%Y}/
   {observed_on:%b upper}/cm{observed_on:%d%b%Y upper}bhav.csv.zip`. Try UDiFF first; on 404 (only),
   fall back to legacy; if legacy also 404s, raise `SourceUnavailableError`. Retry/backoff (item 3)
   applies independently to each URL attempt, not across both.
6. File header + function comments per CLAUDE.md's rule.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/archive/test_downloaders.py -v
```
Expected: `PASS` (5/5).

- [ ] **Step 5: Lint/typecheck + import-linter**

```bash
uv run ruff check src/forecasting_agent/archive tests/archive
uv run mypy src/forecasting_agent/archive
uv run lint-imports
```
Expected: clean; both archive contracts `KEPT`.

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/archive/downloaders/ src/forecasting_agent/archive/errors.py tests/archive/test_downloaders.py tests/archive/fixtures/
git commit -m "feat: add NSE bhavcopy and participant-OI downloaders (#19)"
# note: errors.py is a MODIFY here (Task 2 created it) -- git add will correctly stage the diff, not a new file
```

---

## Task 4: `archive/run_daily.py` — CLI entry point

**Files:**
- Create: `src/forecasting_agent/archive/run_daily.py`
- Test: `tests/archive/test_run_daily.py`

**Interfaces:**
- Consumes: `ObservationStore` (Task 2), `Downloader` subclasses (Task 3), `SourceUnavailableError`
  (Task 3).
- Produces: `main() -> None`, invocable as `python -m forecasting_agent.archive.run_daily`. No downstream
  task consumes this within the plan — it is #19's operational deliverable.

**Seam note:** `run_daily.py` is the only caller that combines downloaders + store — this is where the
Data Flow section's orchestration (200→write, 404→gap, transport failure→retry-then-gap, loud logging)
actually lives; downloaders and store each know nothing about each other.

- [ ] **Step 1: Write the failing test**

```python
# tests/archive/test_run_daily.py
"""Tests for run_daily's orchestration: downloader success/404/exception routed correctly to store.write() and logged."""

import logging
from datetime import date
from unittest.mock import MagicMock, patch

from forecasting_agent.archive.errors import SourceUnavailableError
from forecasting_agent.archive.run_daily import run_all_downloaders


def test_successful_download_writes_ok_row():
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.return_value = b"bytes"

    run_all_downloaders(store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 14))

    mock_store.write.assert_called_once_with(source="test_source", observed_on=date(2026, 8, 14), content=b"bytes")


def test_source_unavailable_writes_gap_row_and_does_not_crash():
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.side_effect = SourceUnavailableError("404")

    run_all_downloaders(store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 15))

    mock_store.write.assert_called_once_with(
        source="test_source", observed_on=date(2026, 8, 15), content=None, detail="404"
    )


def test_gap_is_logged_at_error_level(caplog):
    mock_store = MagicMock()
    mock_downloader = MagicMock()
    mock_downloader.fetch_raw.side_effect = SourceUnavailableError("404")

    with caplog.at_level(logging.ERROR):
        run_all_downloaders(
            store=mock_store, downloaders={"test_source": mock_downloader}, observed_on=date(2026, 8, 15)
        )

    assert any(r.levelno == logging.ERROR for r in caplog.records)


def test_one_downloader_failing_does_not_block_the_others():
    mock_store = MagicMock()
    failing = MagicMock()
    failing.fetch_raw.side_effect = SourceUnavailableError("404")
    succeeding = MagicMock()
    succeeding.fetch_raw.return_value = b"bytes"

    run_all_downloaders(
        store=mock_store,
        downloaders={"failing_source": failing, "succeeding_source": succeeding},
        observed_on=date(2026, 8, 14),
    )

    assert mock_store.write.call_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/archive/test_run_daily.py -v
```
Expected: `FAIL` — `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Requirements:
1. `run_all_downloaders(store: ObservationStore, downloaders: dict[str, Downloader], observed_on:
   date) -> None` — iterates `downloaders`, calls `fetch_raw`, routes to `store.write()` per spec's Data
   Flow (200→bytes, `SourceUnavailableError`→`content=None, detail=str(exc)`, transport failure that
   exhausts retries → same gap path with the exception message as `detail`). One downloader's failure
   must not stop the others (`try`/`except` per-downloader inside the loop, not around the whole loop).
   `logging.getLogger(__name__).error(...)` on every gap.
2. `main()` — builds the real downloader dict (`{"bhavcopy_cm": NseBhavcopyDownloader("CM"),
   "bhavcopy_fo": NseBhavcopyDownloader("FO"), "participant_oi": NseParticipantOiDownloader()}`), a real
   `ObservationStore()`, calls `run_all_downloaders(store, downloaders, observed_on=date.today())`.
3. `if __name__ == "__main__": main()` plus a top-of-file comment documenting the intended cron
   invocation (spec decision 7) — no Makefile target, `uv run python -m
   forecasting_agent.archive.run_daily` already covers it.
4. File header + function comments per CLAUDE.md's rule.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/archive/test_run_daily.py -v
```
Expected: `PASS` (4/4).

- [ ] **Step 5: Lint/typecheck**

```bash
uv run ruff check src/forecasting_agent/archive tests/archive
uv run mypy src/forecasting_agent/archive
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/archive/run_daily.py tests/archive/test_run_daily.py
git commit -m "feat: add run_daily CLI entry point orchestrating archive downloads (#19)"
```

---

## Task 5: OHLCV snapshot hook in `data_server/server.py`

**Files:**
- Modify: `src/forecasting_agent/data_server/server.py` (`fetch_ohlcv`, lines 87-151)
- Test: Add to `tests/data_server/test_pipeline_integration.py` (or a new
  `tests/data_server/test_ohlcv_archive_hook.py` if the existing file's fixtures don't compose cleanly —
  Gemini's call, state which it picked in its report)

**Interfaces:**
- Consumes: `ObservationStore` (Task 2).
- Produces: no new public interface — this is a side-effect addition to an existing function. No
  downstream task consumes it.

**Seam note — the highest-risk task in this plan, read this twice:** the hook fires **only** inside the
existing `if freshly_fetched:` block at `server.py:138` (the one that already does `cache.put(...)`),
**never** on the cache-hit path (`freshly_fetched=False`, line ~107) and **never** on the `data_stale`
fallback path (lines ~118-127). Firing on either of those would stamp today's date onto bytes not
actually observed today — the exact corruption this whole story exists to prevent (spec's Data Flow
section + R5 fix #1). `ArchiveWriteError` from the store is caught and logged, **not** re-raised —
`fetch_ohlcv` had zero Postgres dependency before this story; a raising write would make a core
market-data read path fail whenever the archive DB is unavailable (spec's Error Handling + R5 fix #2).

- [ ] **Step 1: Write the failing test**

```python
# tests/data_server/test_ohlcv_archive_hook.py
"""Tests that fetch_ohlcv archives bars only on a genuine fresh fetch, never on cache-hit or stale-fallback."""

from datetime import date
from unittest.mock import MagicMock, patch

from forecasting_agent.data_server.contracts import OHLCVBar


def _bar(d: date) -> OHLCVBar:
    return OHLCVBar(
        date=d, open=100.0, high=105.0, low=99.0, close=103.0, volume=1000, is_outlier=False, is_circuit_locked=False
    )


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_fresh_fetch_archives_the_bars(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = None
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = [_bar(date(2026, 8, 14))]
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_called_once()
    assert mock_store.write.call_args.kwargs["source"] == "ohlcv:NSE:RELIANCE.NS"


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_cache_hit_does_not_archive(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = [_bar(date(2026, 8, 14))]
    mock_cache.is_stale.return_value = False
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_not_called()


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_stale_fallback_does_not_archive(mock_cache_cls, mock_resolve, mock_store_cls):
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = [_bar(date(2026, 8, 10))]
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = []  # plugin returned nothing -> stale-cache fallback path
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value

    fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    mock_store.write.assert_not_called()


@patch("forecasting_agent.data_server.server.ObservationStore")
@patch("forecasting_agent.data_server.server.resolve")
@patch("forecasting_agent.data_server.server.ParquetCache")
def test_archive_write_failure_is_logged_not_raised(mock_cache_cls, mock_resolve, mock_store_cls, caplog):
    from forecasting_agent.archive.errors import ArchiveWriteError
    from forecasting_agent.data_server.server import fetch_ohlcv

    mock_cache = mock_cache_cls.return_value
    mock_cache.get.return_value = None
    mock_cache.is_stale.return_value = True
    mock_plugin = mock_resolve.return_value
    mock_plugin.fetch.return_value = [_bar(date(2026, 8, 14))]
    mock_plugin.supports.return_value = True
    mock_store = mock_store_cls.return_value
    mock_store.write.side_effect = ArchiveWriteError("db down")

    result = fetch_ohlcv("RELIANCE.NS", "NSE", "2026-08-01", "2026-08-14")

    assert result is not None  # fetch_ohlcv still returns normally
```

`ArchiveWriteError` lives in `forecasting_agent.archive.errors` (Task 2 created this file).

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/data_server/test_ohlcv_archive_hook.py -v
```
Expected: `FAIL` — `AttributeError` or assertion failures on `mock_store.write` (the hook doesn't exist
in `server.py` yet).

- [ ] **Step 3: Implement**

In `server.py`, add near the top: `from forecasting_agent.archive.store import ObservationStore` and
`from forecasting_agent.archive.errors import ArchiveWriteError`. Inside
`fetch_ohlcv`, at line 138's existing block:
```python
    # 7. Cache freshly fetched (pre-filter, cleaned+normalized) result
    if freshly_fetched:
        cache.put(symbol, market, normalized_bars)
        try:
            ObservationStore().write(
                source=f"ohlcv:{market.upper()}:{symbol}",
                observed_on=date.today(),  # noqa: DTZ011 -- matches is_stale()'s existing precedent at cache.py
                content=_serialize_bars(normalized_bars),
            )
        except ArchiveWriteError:
            logger.error("Failed to archive OHLCV snapshot for %s/%s", market, symbol, exc_info=True)
```
Add a small `_serialize_bars(bars: list[OHLCVBar]) -> bytes` helper (e.g. JSON-encode
`[b.model_dump(mode="json") for b in bars]` — Pydantic models, straightforward) in the same file. File
header comment update (one line) noting the new archive dependency; one-line comment on the new helper.

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/data_server/test_ohlcv_archive_hook.py -v
```
Expected: `PASS` (4/4).

- [ ] **Step 5: Full regression + lint/typecheck**

```bash
uv run pytest tests/ -v
uv run ruff check src/forecasting_agent
uv run mypy src/forecasting_agent
uv run lint-imports
```
Expected: all clean, no existing test broken by the new import in `server.py`.

- [ ] **Step 6: Commit**

```bash
git add src/forecasting_agent/data_server/server.py tests/data_server/test_ohlcv_archive_hook.py
git commit -m "feat: archive as-observed OHLCV snapshots on fresh fetch only (#19)"
```

---

## Gemini Delegation Prompts

Give each task to Gemini one at a time, in order — Task 2 needs Task 1's applied migration; Task 3
needs Task 2 to exist for the import-linter contract to mean anything (though downloaders don't import
it); Task 4 needs Tasks 2+3; Task 5 needs Task 2. Paste the full task block (Files/Interfaces/Steps)
verbatim as the prompt, plus this preamble:

```
You are implementing one task from docs/superpowers/plans/2026-08-17-point-in-time-observation-archive-plan.md
in the Forecasting_Agent repo, working in this exact directory (a git worktree already on the right
branch — do not create a new worktree, do not switch branches). Python 3.12, uv, pytest, ruff, mypy.
Follow the task's steps exactly: write the failing test first (or use the one already given verbatim),
run it, confirm it fails for the stated reason, implement the minimal code to pass, run it again, confirm
it passes, run the lint/typecheck/import-linter commands listed, then commit with the exact message
given. Every new file needs a one-line top-of-file abstract comment and one-line input/output comments
on every exported function/class (no docstrings, no multi-line comments). Do not modify files outside
this task's Files list. Do not push. Report the actual test output and lint/typecheck output verbatim,
not a summary claim — "tests pass" without pasted output will be treated as unverified.
```

## Validator Brief (run inline after each Gemini task, before moving to the next task)

For every task, independently re-run from a cold state — do not trust Gemini's self-report (CLAUDE.md's
documented Gemini quality gap: false "all green" claims have recurred on this project):

1. Re-run the task's exact test command yourself, read the actual pass/fail counts.
2. `uv run ruff check . && uv run mypy src/forecasting_agent/archive` — read the actual output.
3. `git status` / `git diff` — confirm only the task's declared Files were touched; check for any
   unprompted writes outside the repo (a recurring `agy` behavior per CLAUDE.md).
4. Task-specific checks:
   - **Task 1:** confirm `SELECT name FROM schema_migrations` on the real DB actually shows
     `003_observation_archive.sql` — a migration file existing on disk is not the same as it being
     applied. Confirm `uv run lint-imports` shows both new contracts `KEPT`.
   - **Task 2:** this is the task most likely to hide a subtle bug — manually re-run
     `test_write_identical_bytes_twice_yields_one_row_and_no_rewritten_file` and read the actual mtime
     values printed/asserted, don't just trust green. Manually inspect one written file on disk
     (`ls data/archive/...` inside whatever `tmp_path` the test used, or add a temporary print) to
     confirm bytes really match. Confirm the bare `ON CONFLICT` form was used, not a targeted one — grep
     the implementation for `ON CONFLICT` and read it.
   - **Task 3:** confirm the two fixture files are real committed files (`git show HEAD:tests/archive/
     fixtures/participant_oi_sample.csv` should return content, not "path does not exist") — this is
     the exact "uncommitted test files" failure class CLAUDE.md documents. If Gemini flagged the
     fixtures as sandbox-approximated rather than live-captured, note that as a known follow-up, not a
     defect. Confirm the retry test's mock call count is exactly 3, by reading the assertion, not the
     pass/fail alone.
   - **Task 4:** confirm one downloader failing truly doesn't block others — read the implementation's
     loop structure, not just the test.
   - **Task 5 — highest scrutiny of all five tasks.** Manually trace: does the archive write call sit
     strictly inside the `if freshly_fetched:` block, or did Gemini place it somewhere broader (e.g.
     unconditionally at the end of the function, which would silently defeat the entire point of this
     task)? Read the actual diff line-by-line, don't rely on the test passing — a wrongly-placed hook
     with a permissive test could still show green. Confirm `ArchiveWriteError` is caught and logged,
     not re-raised, and confirm `uv run pytest tests/` (the full suite) still passes — this task touches
     an existing, previously-Postgres-free function used elsewhere in the codebase.

---

## Smoke Test (Claude runs this after all 5 tasks are verified — NOT delegated to Gemini)

Per-task tests are all mocked-or-isolated except Task 2 (real Postgres). This is the one genuine
end-to-end check across the whole story, against real systems, before calling #19 done:

1. `docker exec forecasting_agent-postgres-1 psql -U harness -d harness -c "SELECT count(*) FROM
   observation_archive;"` — note the count before.
2. `uv run python -m forecasting_agent.archive.run_daily` — run the real CLI entry point, against real
   NSE endpoints (no mocks), for real. Read the actual log output — every downloader should either
   archive successfully or log a gap at ERROR level; nothing should crash the process.
3. Re-run the same `SELECT count(*)` — confirm new rows landed (or gap rows, if run on a non-trading
   day) and that `ls data/archive/` shows real subdirectories with real `.bin` files, not an empty tree.
4. Run it a **second time immediately after** — confirm idempotency for real: the count should not grow
   for sources that already succeeded (per decision 3's `ok` index), and the archived file's mtime should
   not change.
5. Call `fetch_ohlcv` for a real symbol via the MCP server (or directly via `uv run python -c "from
   forecasting_agent.data_server.server import fetch_ohlcv; print(fetch_ohlcv('RELIANCE.NS', 'NSE',
   '2026-08-01', '2026-08-14'))"`) twice in a row — first call should be a fresh fetch (archives), second
   call should be a cache hit (does not archive, per Task 5's gating) — confirm via the `observation_archive`
   row count not growing on the second call.
6. Only once all five checks above hold against real output (not assumed from tests passing) is #19
   considered actually working end-to-end.

## Obsidian Sync (Claude runs this after the smoke test — NOT delegated to Gemini)

Per this repo's CLAUDE.md hard rule, update before the session finishes:
1. `Daily/2026-08-17.md` — log that #19 was implemented and smoke-tested.
2. `Projects/Forecasting Agent/Kanban.md` — move #19 from In Progress → Done.
3. `Projects/Forecasting Agent.md` — check off #19 in the roadmap checklist; note #20 is now unblocked.
4. Any Architecture/Tech Stack sub-note that should mention the new `psycopg` cross-language Postgres
   dependency and the `data/archive/` storage location, if not already covered.
