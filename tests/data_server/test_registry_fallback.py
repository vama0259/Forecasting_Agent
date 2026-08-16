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


def test_same_module_target_shared_across_two_different_fallback_lists() -> None:
    # NSE and BSE both list angelone_equity as primary -- they must share ONE instance
    # (one login), not construct a separate one each, same as the registry already does
    # for markets pointing directly at the same single-string target.
    from forecasting_agent.data_server.registry import PluginRegistry

    manifest = """
NSE:
  - forecasting_agent.data_server.plugins.angelone_equity
  - forecasting_agent.data_server.plugins.nse
BSE:
  - forecasting_agent.data_server.plugins.angelone_equity
  - forecasting_agent.data_server.plugins.nse
"""
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        f.write(manifest)
        path = f.name

    registry = PluginRegistry(manifest_path=path)
    nse_fallback = registry.resolve("NSE")
    bse_fallback = registry.resolve("BSE")

    assert nse_fallback._plugins[0] is bse_fallback._plugins[0]  # same AngelOneEquityPlugin instance
    assert nse_fallback._plugins[1] is bse_fallback._plugins[1]  # same NsePlugin instance
    Path(path).unlink()


def test_list_target_also_shared_with_a_string_target_of_the_same_module() -> None:
    # A market pointing directly at nse.py (string) and a market listing it inside a
    # fallback chain must still share the same NsePlugin instance.
    from forecasting_agent.data_server.registry import PluginRegistry

    manifest = """
BSE: forecasting_agent.data_server.plugins.nse
NSE:
  - forecasting_agent.data_server.plugins.angelone_equity
  - forecasting_agent.data_server.plugins.nse
"""
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        f.write(manifest)
        path = f.name

    registry = PluginRegistry(manifest_path=path)
    bse_plugin = registry.resolve("BSE")
    nse_fallback = registry.resolve("NSE")

    assert nse_fallback._plugins[1] is bse_plugin
    Path(path).unlink()
