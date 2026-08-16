# Angel One session manager handling TOTP authentication, token refresh, and rate limiting.
import logging
import time

import logzero
import pyotp
from SmartApi import SmartConnect

from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials


class AngelOneAuthError(Exception):
    # Raised when Angel One authentication fails.
    pass


class AngelOneSession:
    # Manages SmartAPI authentication session, token lifecycle, and request throttling.

    def __init__(self, credentials: AngelOneCredentials) -> None:
        # Initializes session manager, silences logzero default logger, and creates SmartConnect instance.
        logzero.loglevel(logging.CRITICAL + 1)
        self._credentials = credentials
        self._client = SmartConnect(api_key=credentials.api_key)
        self._jwt_token: str | None = None
        self._refresh_token: str | None = None
        self._token_expiry: float | None = None
        self._last_call_time: float | None = None

    def _rate_limit_gate(self) -> None:
        # Enforces minimum delay between outbound API calls to stay under rate limits.
        now = time.monotonic()
        if self._last_call_time is not None:
            elapsed = now - self._last_call_time
            if elapsed < 0.334:
                time.sleep(0.334 - elapsed)
        self._last_call_time = time.monotonic()

    def _force_expire(self) -> None:
        # Test-only helper to immediately expire the cached token.
        self._token_expiry = -1.0

    def get_valid_token(self) -> str:
        # Returns a valid JWT access token, refreshing or re-authenticating if expired.
        if (
            self._jwt_token is not None
            and self._token_expiry is not None
            and self._token_expiry > 0.0
            and time.monotonic() < self._token_expiry
        ):
            return self._jwt_token

        if self._refresh_token is not None:
            try:
                self._rate_limit_gate()
                response = self._client.generateToken(self._refresh_token)
                if response.get("status"):
                    data = response.get("data")
                    jwt = data.get("jwtToken") if hasattr(data, "get") else None
                    if jwt:
                        self._jwt_token = str(jwt)
                        self._token_expiry = (self._last_call_time or 0.0) + 9000.0
                        refresh = data.get("refreshToken") if hasattr(data, "get") else None
                        if refresh:
                            self._refresh_token = str(refresh)
                        return self._jwt_token
            except KeyError:
                pass

        totp = pyotp.TOTP(self._credentials.totp_secret).now()
        self._rate_limit_gate()
        response = self._client.generateSession(self._credentials.client_code, self._credentials.mpin, totp)
        if not response.get("status"):
            msg = response.get("message", "Angel One login failed")
            raise AngelOneAuthError(str(msg))

        self._jwt_token = str(response["data"]["jwtToken"])
        self._refresh_token = str(response["data"]["refreshToken"])
        self._token_expiry = (self._last_call_time or 0.0) + 9000.0
        return self._jwt_token
