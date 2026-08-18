# Angel One equity market data plugin fetching cash equities for NSE and BSE.
from datetime import date

from forecasting_agent.data_server.contracts import OHLCVBar
from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials
from forecasting_agent.data_server.plugins.angelone_instruments import (
    AngelOneInstrumentMaster,
    SymbolNotFoundError,
)
from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession
from forecasting_agent.data_server.plugins.base import MarketPlugin


class AngelOneApiError(Exception):
    # Raised when Angel One's API returns an explicit failure (status/success False), not a genuine empty result.
    pass


class AngelOneEquityPlugin(MarketPlugin):
    # Market plugin fetching cash equity OHLCV data for NSE and BSE via Angel One SmartAPI.

    def __init__(self, credentials: AngelOneCredentials | None = None) -> None:
        # Initializes AngelOneEquityPlugin with credentials, session manager, and instrument master.
        self._instruments = AngelOneInstrumentMaster()
        if credentials is not None:
            self._credentials: AngelOneCredentials | None = credentials
            self._session: AngelOneSession | None = AngelOneSession(credentials)
        else:
            try:
                creds = AngelOneCredentials.from_env()
                self._credentials = creds
                self._session = AngelOneSession(creds)
            except KeyError:
                self._credentials = None
                self._session = None

    @property
    def symbol_pattern(self) -> str:
        # Returns regex pattern matching valid NSE and BSE equity symbols.
        return r"^.+\.(NS|BO)$"

    def supports(self, symbol: str) -> bool:
        # Checks whether symbol has NSE (.NS) or BSE (.BO) exchange suffix.
        return symbol.endswith((".NS", ".BO"))

    def fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]:
        # Fetches daily OHLCV bars for NSE/BSE symbol between start and end dates from Angel One.
        session = self._session
        if session is None:
            creds = AngelOneCredentials.from_env()
            self._credentials = creds
            session = AngelOneSession(creds)
            self._session = session

        if symbol.endswith(".NS"):
            ao_symbol = symbol[:-3] + "-EQ"
            exchange = "NSE"
        elif symbol.endswith(".BO"):
            ao_symbol = symbol[:-3]
            exchange = "BSE"
        else:
            raise SymbolNotFoundError(f"'{symbol}' is not an NSE/BSE equity symbol")

        token = session.get_valid_token()
        client = session.client
        client.setAccessToken(token)

        instrument_token = self._instruments.resolve(ao_symbol, exchange)

        response = client.getCandleData(
            {
                "exchange": exchange,
                "symboltoken": instrument_token,
                "interval": "ONE_DAY",
                "fromdate": f"{start} 00:00",
                "todate": f"{end} 00:00",
            }
        )

        if response.get("status") is False or response.get("success") is False:
            raise AngelOneApiError(str(response.get("message", "Angel One getCandleData request failed")))

        if not response or not response.get("data"):
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


__all__ = ["AngelOneApiError", "AngelOneEquityPlugin", "SymbolNotFoundError"]
