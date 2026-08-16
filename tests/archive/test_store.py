# Tests for ObservationStore: append-only writes, idempotency, restatement, and gap semantics against real Postgres.

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
    # Takes a pytest tmp_path; returns a fresh ObservationStore rooted there, with its rows cleared after the test.
    s = ObservationStore(archive_dir=str(tmp_path), connection_string=CONN_STRING)
    yield s
    with s._connect() as conn:
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
