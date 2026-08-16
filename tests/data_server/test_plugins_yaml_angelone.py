# Unit tests verifying AngelOnePlugin registration in plugins.yaml.


def test_angelone_registered_under_four_derivative_markets() -> None:
    from forecasting_agent.data_server.registry import PluginRegistry

    registry = PluginRegistry()
    assert "NFO" in registry.list_markets()
    assert "BFO" in registry.list_markets()
    assert "CDS" in registry.list_markets()
    assert "MCX" in registry.list_markets()


def test_nse_bse_still_resolve_to_nse_plugin() -> None:
    from forecasting_agent.data_server.plugins.nse import NsePlugin
    from forecasting_agent.data_server.registry import PluginRegistry

    registry = PluginRegistry()
    assert isinstance(registry.resolve("NSE"), NsePlugin)
    assert isinstance(registry.resolve("BSE"), NsePlugin)
