# Unit tests for FallbackPlugin.
from datetime import date
from unittest.mock import MagicMock


def test_supports_true_if_any_inner_plugin_supports() -> None:
    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin

    primary = MagicMock()
    primary.supports.return_value = False
    secondary = MagicMock()
    secondary.supports.return_value = True

    plugin = FallbackPlugin([primary, secondary])
    assert plugin.supports("X.NS") is True


def test_fetch_uses_primary_when_it_succeeds_never_calls_secondary() -> None:
    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin

    primary = MagicMock()
    primary.fetch.return_value = ["bar1"]
    secondary = MagicMock()

    plugin = FallbackPlugin([primary, secondary])
    bars = plugin.fetch("RELIANCE.NS", date(2026, 1, 1), date(2026, 1, 2))

    assert bars == ["bar1"]
    secondary.fetch.assert_not_called()


def test_fetch_falls_back_to_secondary_on_primary_exception(caplog) -> None:
    import logging

    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin

    primary = MagicMock()
    primary.fetch.side_effect = RuntimeError("primary broke")
    secondary = MagicMock()
    secondary.fetch.return_value = ["bar_from_secondary"]

    plugin = FallbackPlugin([primary, secondary])
    with caplog.at_level(logging.WARNING):
        bars = plugin.fetch("RELIANCE.NS", date(2026, 1, 1), date(2026, 1, 2))

    assert bars == ["bar_from_secondary"]
    assert "primary broke" in caplog.text


def test_fetch_returns_primarys_empty_list_without_falling_back() -> None:
    # Empty data is a legitimate answer, not a failure -- must not trigger fallback.
    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin

    primary = MagicMock()
    primary.fetch.return_value = []
    secondary = MagicMock()

    plugin = FallbackPlugin([primary, secondary])
    bars = plugin.fetch("RELIANCE.NS", date(2026, 1, 1), date(2026, 1, 2))

    assert bars == []
    secondary.fetch.assert_not_called()


def test_fetch_raises_last_exception_when_every_plugin_fails() -> None:
    import pytest

    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin

    primary = MagicMock()
    primary.fetch.side_effect = RuntimeError("primary broke")
    secondary = MagicMock()
    secondary.fetch.side_effect = ValueError("secondary broke too")

    plugin = FallbackPlugin([primary, secondary])
    with pytest.raises(ValueError, match="secondary broke too"):
        plugin.fetch("RELIANCE.NS", date(2026, 1, 1), date(2026, 1, 2))
