# Unit tests for AngelOneCredentials.
import pytest


def test_from_env_reads_all_four_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    monkeypatch.setenv("ANGELONE_API_KEY", "k")
    monkeypatch.setenv("ANGELONE_CLIENT_CODE", "c")
    monkeypatch.setenv("ANGELONE_MPIN", "1234")
    monkeypatch.setenv("ANGELONE_TOTP_SECRET", "s")

    creds = AngelOneCredentials.from_env()
    assert creds.api_key == "k"
    assert creds.client_code == "c"
    assert creds.mpin == "1234"
    assert creds.totp_secret == "s"


def test_from_env_raises_on_missing_var(monkeypatch: pytest.MonkeyPatch) -> None:
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    monkeypatch.delenv("ANGELONE_API_KEY", raising=False)
    with pytest.raises(KeyError):
        AngelOneCredentials.from_env()


def test_credentials_is_frozen() -> None:
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    creds = AngelOneCredentials(api_key="k", client_code="c", mpin="1234", totp_secret="s")
    with pytest.raises(AttributeError):
        setattr(creds, "api_key", "changed")  # noqa: B010
