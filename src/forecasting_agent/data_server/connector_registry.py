# Registry managing dynamic loading and instantiation of archive-derived connector plugins.

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin


class ConnectorRegistry:
    # Registry managing dynamic loading and instantiation of archive connector plugins.

    def __init__(self, manifest_path: Path | str | None = None) -> None:
        # Initializes connector registry from YAML manifest path or default.
        if manifest_path is None:
            self._manifest_path = Path(__file__).parent / "connectors.yaml"
        else:
            self._manifest_path = Path(manifest_path)

        self._connectors: dict[str, ArchiveDerivedPlugin] = {}
        self._load_connectors()

    def _load_connectors(self) -> None:
        if not self._manifest_path.exists():
            raise FileNotFoundError(f"Connector manifest not found at {self._manifest_path}")

        with open(self._manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f) or {}

        if not isinstance(manifest, dict):
            raise ValueError(f"Invalid connector manifest format at {self._manifest_path}, expected dictionary")

        module_instances: dict[str, ArchiveDerivedPlugin] = {}

        for name, target in manifest.items():
            connector_key = str(name).strip().lower()
            target_str = str(target).strip()

            if target_str not in module_instances:
                connector_instance = self._instantiate_connector(target_str)
                module_instances[target_str] = connector_instance

            self._connectors[connector_key] = module_instances[target_str]

    def _instantiate_connector(self, target: str) -> ArchiveDerivedPlugin:
        if ":" in target:
            module_name, class_name = target.split(":", 1)
            module = importlib.import_module(module_name)
            connector_cls: Any = getattr(module, class_name)
        else:
            module = importlib.import_module(target)
            connector_cls = self._find_connector_class(module)

        if not isinstance(connector_cls, type) or not issubclass(connector_cls, ArchiveDerivedPlugin):
            raise TypeError(f"Target '{target}' resolved to non-subclass of ArchiveDerivedPlugin")

        instance: ArchiveDerivedPlugin = connector_cls()
        return instance

    @staticmethod
    def _find_connector_class(module: Any) -> type[ArchiveDerivedPlugin]:
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if isinstance(attr, type) and issubclass(attr, ArchiveDerivedPlugin) and attr is not ArchiveDerivedPlugin:
                return attr
        raise ValueError(f"No ArchiveDerivedPlugin subclass found in module '{module.__name__}'")

    def resolve(self, name: str) -> ArchiveDerivedPlugin:
        # Resolves a connector identifier to its instantiated plugin instance.
        key = name.strip().lower()
        if key not in self._connectors:
            supported = ", ".join(sorted(self._connectors.keys()))
            raise KeyError(f"Connector '{name}' is not registered in manifest. Supported connectors: [{supported}]")
        return self._connectors[key]

    def list_connectors(self) -> list[str]:
        # Returns a list of all registered connector identifiers.
        return sorted(self._connectors.keys())


_DEFAULT_CONNECTOR_REGISTRY: ConnectorRegistry | None = None


def get_connector_registry() -> ConnectorRegistry:
    # Returns the global default connector registry instance.
    global _DEFAULT_CONNECTOR_REGISTRY
    if _DEFAULT_CONNECTOR_REGISTRY is None:
        _DEFAULT_CONNECTOR_REGISTRY = ConnectorRegistry()
    registry = _DEFAULT_CONNECTOR_REGISTRY
    if registry is None:
        registry = ConnectorRegistry()
        _DEFAULT_CONNECTOR_REGISTRY = registry
    return registry


def resolve(name: str) -> ArchiveDerivedPlugin:
    # Resolves a connector identifier using the default registry.
    return get_connector_registry().resolve(name)


def list_connectors() -> list[str]:
    # Lists all registered connectors using the default registry.
    return get_connector_registry().list_connectors()


__all__ = ["ConnectorRegistry", "get_connector_registry", "list_connectors", "resolve"]
