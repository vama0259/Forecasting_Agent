# Applies the harness storage .sql migrations to STORAGE_CONNECTION_STRING so Python integration tests have a schema.

import os
import pathlib
import sys

import psycopg

MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "harness" / "src" / "storage" / "migrations"


def _log(message: str) -> None:
    # Takes a message; writes it to stderr so this CI helper needs no logging config.
    sys.stderr.write(f"{message}\n")


def main() -> int:
    # Takes no arguments (reads STORAGE_CONNECTION_STRING); returns a process exit code.
    conn_string = os.environ.get("STORAGE_CONNECTION_STRING")
    if not conn_string:
        _log("STORAGE_CONNECTION_STRING is not set")
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        _log(f"no .sql migrations found under {MIGRATIONS_DIR}")
        return 1

    with psycopg.connect(conn_string, autocommit=True) as conn:
        for path in files:
            _log(f"applying {path.name}")
            conn.execute(path.read_text(encoding="utf-8"))

    return 0


if __name__ == "__main__":
    sys.exit(main())
