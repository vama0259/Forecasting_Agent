# Angel One derivative and commodity market data plugin wrapping SmartAPI.
import re
from datetime import date

from SmartApi import SmartConnect

from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials
from forecasting_agent.data_server.plugins.angelone_instruments import (
    AngelOneInstrumentMaster,
    SymbolNotFoundError,
)
from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession
from forecasting_agent.data_server.plugins.base import MarketPlugin


class AngelOnePlugin(MarketPlugin):
    # Market plugin fetching historical OHLCV data for NFO, BFO, CDS, and MCX via SmartAPI.

    def __init__(self, credentials: AngelOneCredentials | None = None) -> None:
        # Initializes AngelOnePlugin with credentials, session manager, instrument master, and API client.
        self._instruments = AngelOneInstrumentMaster()
        if credentials is not None:
            self._credentials: AngelOneCredentials | None = credentials
            self._session: AngelOneSession | None = AngelOneSession(credentials)
            self._client: SmartConnect | None = SmartConnect(api_key=credentials.api_key)
        else:
            try:
                self._credentials = AngelOneCredentials.from_env()
                self._session = AngelOneSession(self._credentials)
                self._client = SmartConnect(api_key=self._credentials.api_key)
            except KeyError:
                self._credentials = None
                self._session = None
                self._client = None

    @property
    def symbol_pattern(self) -> str:
        # Returns regex pattern matching Angel One F&O, currency, and commodity trading symbols.
        return r"^[A-Z0-9]+\d{2}[A-Z]{3}(\d{2})?(\d+(CE|PE)|FUT)$"

    def supports(self, symbol: str) -> bool:
        # Checks whether symbol matches Angel One derivative/commodity symbol pattern.
        return bool(re.match(self.symbol_pattern, symbol))

    def fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]:
        # Fetches daily OHLCV bars for the given symbol across start and end dates from Angel One.
        if self._session is None or self._client is None:
            self._credentials = AngelOneCredentials.from_env()
            self._session = AngelOneSession(self._credentials)
            self._client = SmartConnect(api_key=self._credentials.api_key)

        token = self._session.get_valid_token()
        self._client.setAccessToken(token)

        instrument_token: str | None = None
        matched_exchange: str | None = None
        for exch in ("NFO", "BFO", "CDS", "MCX"):
            try:
                instrument_token = self._instruments.resolve(symbol, exch)
                matched_exchange = exch
                break
            except SymbolNotFoundError:
                continue

        if instrument_token is None or matched_exchange is None:
            raise SymbolNotFoundError(f"Symbol '{symbol}' not found in NFO, BFO, CDS, or MCX")

        # Known gap: getCandleData is not routed through AngelOneSession's rate limiter.
        response = self._client.getCandleData(
            {
                "exchange": matched_exchange,
                "symboltoken": instrument_token,
                "interval": "ONE_DAY",
                "fromdate": f"{start} 00:00",
                "todate": f"{end} 00:00",
            }
        )

        if not response or not response.get("status") or not response.get("data"):
            return []

        bars: list[OHLCVBar] = []
        for row in response["data"]:
            ts_str = str(row[0])
            bar_date = date.fromisoformat(ts_str[:10])
            bars.append(
                OHLCVBar(
                    date=bar_date,
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=int(row[5]),
                    is_outlier=False,
                    is_circuit_locked=False,
                )
            )

        return bars


__all__ = ["AngelOnePlugin"]
