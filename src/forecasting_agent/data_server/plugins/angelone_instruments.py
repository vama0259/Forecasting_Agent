# Angel One instrument master table resolver for symbol token mapping.
from typing import Any

import httpx

INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"


class SymbolNotFoundError(Exception):
    # Raised when a trading symbol cannot be resolved to an instrument token.
    pass


class AngelOneInstrumentMaster:
    # Resolves trading symbols to Angel One instrument tokens via cached scrip master file.

    def __init__(self) -> None:
        # Initializes the instrument master resolver with an empty cache.
        self._instruments: list[dict[str, Any]] | None = None

    def resolve(self, tradingsymbol: str, exchange: str) -> str:
        # Resolves trading symbol and exchange to instrument token string, raising SymbolNotFoundError if missing.
        instruments = self._instruments
        if instruments is None:
            resp = httpx.get(INSTRUMENT_MASTER_URL, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            instruments = data if isinstance(data, list) else []
            self._instruments = instruments

        for row in instruments:
            if row.get("symbol") == tradingsymbol and row.get("exch_seg") == exchange:
                return str(row["token"])

        raise SymbolNotFoundError(f"Symbol '{tradingsymbol}' on exchange '{exchange}' not found in instrument master")
