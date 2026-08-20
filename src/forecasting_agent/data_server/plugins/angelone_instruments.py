# Angel One instrument master table resolver for symbol token mapping and option chain enumeration.
import json
import logging
import os
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

_OPTION_INSTRUMENT_TYPES = ("OPTSTK", "OPTIDX")

logger = logging.getLogger(__name__)


class SymbolNotFoundError(Exception):
    # Raised when a trading symbol cannot be resolved to an instrument token.
    pass


class AngelOneInstrumentMaster:
    # Resolves trading symbols to Angel One instrument tokens via cached scrip master file.

    DEFAULT_CACHE_DIR = Path("data/cache/instruments")

    def __init__(self, cache_dir: Path | str | None = None) -> None:
        # Initializes the instrument master resolver with an empty memory cache and disk cache path.
        self._instruments: list[dict[str, Any]] | None = None
        self._cache_dir = Path(cache_dir) if cache_dir is not None else self.DEFAULT_CACHE_DIR

    def _cache_file_path(self) -> Path:
        # Returns the full path to the cached scrip master JSON file.
        return self._cache_dir / "OpenAPIScripMaster.json"

    def _is_cache_valid(self, cache_file: Path) -> bool:
        # Returns True if cache file exists, is non-empty, and was modified on the current calendar date.
        if not cache_file.exists() or not cache_file.is_file():
            return False
        try:
            stat = cache_file.stat()
            if stat.st_size == 0:
                return False
            mtime_date = date.fromtimestamp(stat.st_mtime)  # noqa: DTZ012
            return mtime_date == date.today()  # noqa: DTZ011 -- local day matches Angel One daily publish cycle
        except OSError:
            return False

    def _load_from_disk(self, cache_file: Path) -> list[dict[str, Any]] | None:
        # Reads and parses scrip master list from disk cache file, returning None on error.
        try:
            with open(cache_file, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else None
        except (OSError, json.JSONDecodeError) as exc:
            logger.debug("Failed to read instrument cache from %s: %s", cache_file, exc)
            return None

    def _write_to_disk(self, cache_file: Path, data: list[dict[str, Any]]) -> None:
        # Writes scrip master data atomically to disk cache file using a temporary file.
        try:
            self._cache_dir.mkdir(parents=True, exist_ok=True)
            tmp_file = cache_file.with_name(f"{cache_file.name}.{os.getpid()}.{time.time_ns()}.tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
            tmp_file.replace(cache_file)
        except OSError as exc:
            logger.debug("Failed to write instrument cache to %s: %s", cache_file, exc)

    def _load(self) -> list[dict[str, Any]]:
        # Returns cached scrip master rows, checking in-memory, disk cache, then network fetch.
        if self._instruments is not None:
            return self._instruments

        cache_file = self._cache_file_path()
        if self._is_cache_valid(cache_file):
            disk_data = self._load_from_disk(cache_file)
            if disk_data is not None:
                self._instruments = disk_data
                return disk_data

        try:
            resp = httpx.get(INSTRUMENT_MASTER_URL, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            instruments = data if isinstance(data, list) else []
            self._instruments = instruments
            self._write_to_disk(cache_file, instruments)
            return instruments
        except Exception as exc:
            disk_data = self._load_from_disk(cache_file)
            if disk_data is not None:
                logger.warning("Live instrument master fetch failed (%s); using stale disk cache", exc)
                self._instruments = disk_data
                return disk_data
            raise

    def resolve(self, tradingsymbol: str, exchange: str) -> str:
        # Resolves trading symbol and exchange to instrument token string, raising SymbolNotFoundError if missing.
        for row in self._load():
            if row.get("symbol") == tradingsymbol and row.get("exch_seg") == exchange:
                return str(row["token"])

        raise SymbolNotFoundError(f"Symbol '{tradingsymbol}' on exchange '{exchange}' not found in instrument master")

    def list_option_chain(
        self, name: str, exch_seg: str = "NFO", expiry: str | None = None, as_of: date | None = None
    ) -> list[dict[str, Any]]:
        # Takes an underlying name and optional expiry ("DDMMMYYYY", e.g. "29SEP2026"); returns every
        # OPTSTK/OPTIDX contract row for that underlying's given expiry, or its nearest expiry on/after
        # as_of (default today) when expiry is omitted. Returns [] if the underlying has no such contracts.
        contracts = [
            row
            for row in self._load()
            if row.get("name") == name
            and row.get("exch_seg") == exch_seg
            and row.get("instrumenttype") in _OPTION_INSTRUMENT_TYPES
        ]
        if not contracts:
            return []

        if expiry is None:
            reference = as_of or date.today()  # noqa: DTZ011
            future_expiries = sorted(
                {
                    parsed
                    for row in contracts
                    if (parsed := self._parse_expiry(row.get("expiry", ""))) is not None and parsed >= reference
                }
            )
            if not future_expiries:
                return []
            expiry = future_expiries[0].strftime("%d%b%Y").upper()

        return [row for row in contracts if row.get("expiry") == expiry]

    @staticmethod
    def _parse_expiry(raw: str) -> date | None:
        # Takes a scrip master expiry string ("29SEP2026"); returns its date, or None if unparsable.
        try:
            return datetime.strptime(raw, "%d%b%Y").date()  # noqa: DTZ007 -- only .date() is used, tz is irrelevant
        except ValueError:
            return None
