# Fetches live NSE/BFO option chain snapshots (strikes, call/put OI and LTP) via Angel One SmartAPI.
#
# NOT LIVE-VERIFIED: getMarketData's "FULL" mode response field names (symbolToken, ltp, opnInterest)
# are taken from SmartAPI's documented quote schema, not from a real successful response -- every
# live call made while building this (optionGreek, putCallRatio, getMarketData) returned "No data
# available" because it was tested outside NSE market hours (05:20 IST, market opens 09:15 IST).
# The instrument-token enumeration this depends on IS live-verified (435 real TCS contracts, real
# strikes/expiries, pulled from the real scrip master). Re-verify the quote field names against a
# real response during market hours before trusting this in a scored run.
from datetime import date, datetime
from typing import Any

from forecasting_agent.data_server.contracts import StrikeData
from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials
from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster
from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

_QUOTE_BATCH_SIZE = 50  # SmartAPI getMarketData's documented per-call token limit.


class AngelOneApiError(Exception):
    # Raised on an explicit Angel One API error response -- never silently swallowed into an empty chain.
    pass


class AngelOneOptionChainPlugin:
    # Fetches a live option chain snapshot (strikes, call/put OI and LTP) for an underlying via SmartAPI.

    def __init__(
        self,
        credentials: AngelOneCredentials | None = None,
        instruments: AngelOneInstrumentMaster | None = None,
        session: AngelOneSession | None = None,
    ) -> None:
        # Initializes with credentials/instrument-master/session, all overridable for tests.
        self._instruments = instruments or AngelOneInstrumentMaster()
        if session is not None:
            self._session: AngelOneSession = session
        else:
            creds = credentials or AngelOneCredentials.from_env()
            self._session = AngelOneSession(creds)

    def fetch_chain(
        self, underlying: str, expiry: str | None = None, as_of: date | None = None, exch_seg: str = "NFO"
    ) -> tuple[date, list[StrikeData]]:
        # Takes an underlying symbol and optional expiry/as_of; returns the resolved expiry date and
        # the strike ladder (call/put OI + LTP per strike) for that underlying's option chain.
        contracts = self._instruments.list_option_chain(underlying, exch_seg=exch_seg, expiry=expiry, as_of=as_of)
        if not contracts:
            raise AngelOneApiError(f"No {exch_seg} option contracts found for '{underlying}'")

        resolved_expiry = datetime.strptime(  # noqa: DTZ007 -- only .date() is used, tz is irrelevant
            contracts[0]["expiry"], "%d%b%Y"
        ).date()

        token = self._session.get_valid_token()
        client = self._session.client
        client.setAccessToken(token)

        contracts_by_token = {str(c["token"]): c for c in contracts}
        strikes_map: dict[float, dict[str, float | int]] = {}
        tokens = list(contracts_by_token.keys())
        for i in range(0, len(tokens), _QUOTE_BATCH_SIZE):
            batch = tokens[i : i + _QUOTE_BATCH_SIZE]
            response = client.getMarketData("FULL", {exch_seg: batch})
            if response.get("status") is False:
                raise AngelOneApiError(str(response.get("message", "Angel One getMarketData request failed")))

            for row in (response.get("data") or {}).get("fetched") or []:
                contract = contracts_by_token.get(str(row.get("symbolToken")))
                if contract is not None:
                    self._merge_quote(contract, row, strikes_map)

        strikes = [
            StrikeData(
                strike_price=strike_price,
                call_oi=int(info.get("call_oi", 0)),
                put_oi=int(info.get("put_oi", 0)),
                call_ltp=float(info.get("call_ltp", 0.0)),
                put_ltp=float(info.get("put_ltp", 0.0)),
            )
            for strike_price, info in sorted(strikes_map.items())
        ]
        return resolved_expiry, strikes

    @staticmethod
    def _merge_quote(
        contract: dict[str, Any], row: dict[str, Any], strikes_map: dict[float, dict[str, float | int]]
    ) -> None:
        # Takes one resolved contract row and its getMarketData quote row; merges call or put OI/LTP
        # into strikes_map, keyed by the real strike price (the scrip master stores strike * 100).
        symbol = str(contract.get("symbol", ""))
        strike_price = float(contract.get("strike", 0)) / 100.0
        if strike_price <= 0:
            return
        is_call = symbol.endswith("CE")
        is_put = symbol.endswith("PE")
        if not (is_call or is_put):
            return

        entry = strikes_map.setdefault(strike_price, {})
        oi = int(row.get("opnInterest", 0) or 0)
        ltp = float(row.get("ltp", 0.0) or 0.0)
        if is_call:
            entry["call_oi"] = oi
            entry["call_ltp"] = ltp
        else:
            entry["put_oi"] = oi
            entry["put_ltp"] = ltp
