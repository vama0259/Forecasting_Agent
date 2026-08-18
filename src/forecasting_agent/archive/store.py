# Raw append-only byte store and PostgreSQL index for point-in-time observations.

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import psycopg

from forecasting_agent.archive.errors import ArchiveWriteError


@dataclass(frozen=True)
class ObservationRecord:
    # Immutable point-in-time observation metadata record from index.
    id: str
    source: str
    observed_on: date
    retrieved_at: datetime
    uri: str | None
    sha256: str | None
    bytes_len: int | None
    status: str
    detail: str | None


class ObservationStore:
    # Append-only raw content and metadata storage for observation records.

    def __init__(self, archive_dir: str = "data/archive", connection_string: str | None = None) -> None:
        # Initializes store with local archive root directory and PostgreSQL connection string.
        self.archive_dir = Path(archive_dir)
        self.connection_string = (
            connection_string or os.environ.get("STORAGE_CONNECTION_STRING") or "postgresql://localhost:5432/harness"
        )

    def _connect(self) -> psycopg.Connection:
        # Opens and returns a synchronous psycopg connection.
        return psycopg.connect(self.connection_string)

    def write(
        self,
        source: str,
        observed_on: date,
        content: bytes | None,
        retrieved_at: datetime | None = None,
        detail: str | None = None,
    ) -> None:
        # Writes observation content to disk and indexes row in PostgreSQL.
        ts = retrieved_at or datetime.now(UTC)
        uri: str | None = None
        sha256: str | None = None
        bytes_len: int | None = None
        status: str = "gap"

        if content is not None:
            sha256 = hashlib.sha256(content).hexdigest()
            bytes_len = len(content)
            status = "ok"
            sanitized_source = re.sub(r"[^\w\-:]", "_", source)
            source_dir = (self.archive_dir / sanitized_source).resolve()
            archive_root = self.archive_dir.resolve()
            if not source_dir.is_relative_to(archive_root):
                raise ArchiveWriteError(f"Invalid archive path for source: {source}")
            source_dir.mkdir(parents=True, exist_ok=True)
            file_path = source_dir / f"{sha256}.bin"
            if not file_path.exists():
                file_path.write_bytes(content)
            uri = str(file_path)

        record_id = uuid.uuid4()
        try:
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO observation_archive (
                        id, source, observed_on, retrieved_at, uri, sha256, bytes_len, status, detail
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """,
                    (record_id, source, observed_on, ts, uri, sha256, bytes_len, status, detail),
                )
                conn.commit()
        except Exception as exc:
            raise ArchiveWriteError(str(exc)) from exc

    def read(self, source: str, observed_on: date) -> bytes | None:
        # Reads raw bytes for the latest ok observation on given date or returns None.
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT uri FROM observation_archive
                WHERE source = %s AND observed_on = %s AND status = 'ok'
                ORDER BY retrieved_at DESC
                LIMIT 1
                """,
                (source, observed_on),
            )
            row = cur.fetchone()
            if row is not None and row[0] is not None:
                return Path(row[0]).read_bytes()
        return None

    def read_history(self, source: str, observed_on: date) -> list[ObservationRecord]:
        # Returns chronological history of observation records for given source and date.
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source, observed_on, retrieved_at, uri, sha256, bytes_len, status, detail
                FROM observation_archive
                WHERE source = %s AND observed_on = %s
                ORDER BY retrieved_at ASC
                """,
                (source, observed_on),
            )
            rows = cur.fetchall()
            return [
                ObservationRecord(
                    id=str(r[0]),
                    source=str(r[1]),
                    observed_on=r[2],
                    retrieved_at=r[3],
                    uri=r[4],
                    sha256=r[5],
                    bytes_len=r[6],
                    status=str(r[7]),
                    detail=r[8],
                )
                for r in rows
            ]
