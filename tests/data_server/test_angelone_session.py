# Unit tests for AngelOneSession.
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

CREDS = AngelOneCredentials(api_key="k", client_code="c", mpin="1234", totp_secret="JBSWY3DPEHPK3PXP")


def _login_response(jwt: str = "jwt1", refresh: str = "ref1") -> dict[str, Any]:
    return {"status": True, "data": {"jwtToken": jwt, "refreshToken": refresh, "feedToken": "feed1"}}


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_get_valid_token_logs_in_on_first_call(mock_sc_cls: MagicMock, mock_totp_cls: MagicMock) -> None:
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    token = session.get_valid_token()

    assert token == "jwt1"
    mock_sc.generateSession.assert_called_once_with("c", "1234", "123456")


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_get_valid_token_reuses_cached_token_within_validity(mock_sc_cls: MagicMock, mock_totp_cls: MagicMock) -> None:
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session.get_valid_token()

    mock_sc.generateSession.assert_called_once()


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_refresh_failure_falls_back_to_full_relogin(mock_sc_cls: MagicMock, mock_totp_cls: MagicMock) -> None:
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response(jwt="jwt1")
    mock_sc.generateToken.side_effect = KeyError("data")  # SDK's real undocumented failure mode
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session._force_expire()  # test-only hook forcing the refresh path
    token = session.get_valid_token()

    assert token == "jwt1"  # fell back to a fresh generateSession, not a crash
    assert mock_sc.generateSession.call_count == 2


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_login_failure_raises_with_sdk_message_not_credentials(
    mock_sc_cls: MagicMock, mock_totp_cls: MagicMock
) -> None:
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = {"status": False, "message": "Invalid credentials"}
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneAuthError, AngelOneSession

    session = AngelOneSession(CREDS)
    with pytest.raises(AngelOneAuthError) as exc_info:
        session.get_valid_token()

    assert str(exc_info.value) == "Invalid credentials"
    assert CREDS.mpin not in str(exc_info.value)
    assert CREDS.totp_secret not in str(exc_info.value)


@patch("forecasting_agent.data_server.plugins.angelone_session.logzero")
@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_init_suppresses_logzero_default_logger(
    mock_sc_cls: MagicMock, mock_totp_cls: MagicMock, mock_logzero: MagicMock
) -> None:
    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    AngelOneSession(CREDS)

    mock_logzero.loglevel.assert_called_once()


@patch("forecasting_agent.data_server.plugins.angelone_session.time.monotonic")
@patch("forecasting_agent.data_server.plugins.angelone_session.time.sleep")
@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_rate_limit_gate_sleeps_when_calls_too_close(
    mock_sc_cls: MagicMock, mock_totp_cls: MagicMock, mock_sleep: MagicMock, mock_monotonic: MagicMock
) -> None:
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"
    mock_monotonic.side_effect = [0.0, 0.0, 0.1, 0.1]  # two calls 0.1s apart, under the 1/3s floor

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session._force_expire()
    session.get_valid_token()

    assert mock_sleep.called
