# Tests that PluginRegistry builds a FallbackPlugin for list-valued manifest entries.
import tempfile
from pathlib import Path


def test_list_value_builds_fallback_plugin() -> None:
    from forecasting_agent.data_server.plugins.fallback import FallbackPlugin
    from forecasting_agent.data_server.registry import PluginRegistry

    manifest = """
NSE:
  - forecasting_agent.data_server.plugins.angelone_equity
  - forecasting_agent.data_server.plugins.nse
"""
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        f.write(manifest)
        path = f.name

    registry = PluginRegistry(manifest_path=path)
    plugin = registry.resolve("NSE")

    assert isinstance(plugin, FallbackPlugin)
    Path(path).unlink()


def test_string_value_still_works_unchanged() -> None:
    from forecasting_agent.data_server.plugins.nse import NsePlugin
    from forecasting_agent.data_server.registry import PluginRegistry

    manifest = "NSE: forecasting_agent.data_server.plugins.nse\n"
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        f.write(manifest)
        path = f.name

    registry = PluginRegistry(manifest_path=path)
    plugin = registry.resolve("NSE")

    assert isinstance(plugin, NsePlugin)
    Path(path).unlink()
