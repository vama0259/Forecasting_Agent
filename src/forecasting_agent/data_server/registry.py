"""Market data plugin registry."""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

from forecasting_agent.data_server.plugins.base import MarketPlugin
from forecasting_agent.data_server.plugins.fallback import FallbackPlugin


class PluginRegistry:
    """Registry managing dynamic loading and instantiation of market plugins."""

    def __init__(self, manifest_path: Path | str | None = None) -> None:
        if manifest_path is None:
            self._manifest_path = Path(__file__).parent / "plugins.yaml"
        else:
            self._manifest_path = Path(manifest_path)

        self._plugins: dict[str, MarketPlugin] = {}
        self._load_plugins()

    def _load_plugins(self) -> None:
        if not self._manifest_path.exists():
            raise FileNotFoundError(f"Plugin manifest not found at {self._manifest_path}")

        with open(self._manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f) or {}

        if not isinstance(manifest, dict):
            raise ValueError(f"Invalid plugin manifest format at {self._manifest_path}, expected dictionary")

        module_instances: dict[str, MarketPlugin] = {}

        for market, target in manifest.items():
            market_key = str(market).strip().upper()

            if isinstance(target, list):
                plugin_list: list[MarketPlugin] = [self._instantiate_plugin(str(item).strip()) for item in target]
                self._plugins[market_key] = FallbackPlugin(plugin_list)
            else:
                target_str = str(target).strip()

                if target_str not in module_instances:
                    plugin_instance = self._instantiate_plugin(target_str)
                    module_instances[target_str] = plugin_instance

                self._plugins[market_key] = module_instances[target_str]

    def _instantiate_plugin(self, target: str) -> MarketPlugin:
        if ":" in target:
            module_name, class_name = target.split(":", 1)
            module = importlib.import_module(module_name)
            plugin_cls: Any = getattr(module, class_name)
        else:
            module = importlib.import_module(target)
            plugin_cls = self._find_plugin_class(module)

        if not isinstance(plugin_cls, type) or not issubclass(plugin_cls, MarketPlugin):
            raise TypeError(f"Target '{target}' resolved to {plugin_cls}, which is not a subclass of MarketPlugin")

        instance: MarketPlugin = plugin_cls()
        return instance

    def _find_plugin_class(self, module: Any) -> type[MarketPlugin]:
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if isinstance(attr, type) and issubclass(attr, MarketPlugin) and attr is not MarketPlugin:
                return attr
        raise ValueError(f"No MarketPlugin subclass found in module '{module.__name__}'")

    def resolve(self, market: str) -> MarketPlugin:
        """Resolve a market code to its instantiated plugin."""
        key = market.strip().upper()
        if key not in self._plugins:
            supported = ", ".join(sorted(self._plugins.keys()))
            raise KeyError(f"Market '{market}' is not registered in manifest. Supported markets: [{supported}]")
        return self._plugins[key]

    def list_markets(self) -> list[str]:
        """Return a list of all registered market identifiers."""
        return sorted(self._plugins.keys())


_DEFAULT_REGISTRY: PluginRegistry | None = None


def get_registry() -> PluginRegistry:
    """Return the global default plugin registry instance."""
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = PluginRegistry()
    return _DEFAULT_REGISTRY


def resolve(market: str) -> MarketPlugin:
    """Resolve a market code to its instantiated plugin using the default registry."""
    return get_registry().resolve(market)


def list_markets() -> list[str]:
    """List all registered markets using the default registry."""
    return get_registry().list_markets()


__all__ = ["MarketPlugin", "PluginRegistry", "get_registry", "list_markets", "resolve"]
