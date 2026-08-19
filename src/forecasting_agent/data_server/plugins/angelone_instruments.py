# Angel One instrument master table resolver for symbol token mapping and option chain enumeration.
from datetime import date, datetime
from typing import Any

import httpx

INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

_OPTION_INSTRUMENT_TYPES = ("OPTSTK", "OPTIDX")


class SymbolNotFoundError(Exception):
    # Raised when a trading symbol cannot be resolved to an instrument token.
    pass


class AngelOneInstrumentMaster:
    # Resolves trading symbols to Angel One instrument tokens via cached scrip master file.

    def __init__(self) -> None:
        # Initializes the instrument master resolver with an empty cache.
        self._instruments: list[dict[str, Any]] | None = None

    def _load(self) -> list[dict[str, Any]]:
        # Takes nothing; returns the cached scrip master rows, fetching once on first call.
        instruments = self._instruments
        if instruments is None:
            resp = httpx.get(INSTRUMENT_MASTER_URL, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            instruments = data if isinstance(data, list) else []
            self._instruments = instruments
        return instruments

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
