from datetime import date

import pytest


def test_registry_resolves_a_connector_from_a_temporary_manifest(tmp_path):
    from forecasting_agent.data_server.connector_registry import ConnectorRegistry

    stub_module = tmp_path / "stub_connector.py"
    stub_module.write_text(
        "from datetime import date\n"
        "from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin\n\n"
        "class StubConnector(ArchiveDerivedPlugin):\n"
        "    def fetch(self, observed_on: date) -> list:\n"
        "        return ['stub']\n"
    )
    manifest = tmp_path / "test_connectors.yaml"
    manifest.write_text("stub: stub_connector\n")

    import sys

    sys.path.insert(0, str(tmp_path))
    try:
        registry = ConnectorRegistry(manifest_path=manifest)
        connector = registry.resolve("stub")
        assert connector.fetch(date(2026, 8, 14)) == ["stub"]
    finally:
        sys.path.remove(str(tmp_path))


def test_registry_raises_key_error_for_unknown_connector(tmp_path):
    from forecasting_agent.data_server.connector_registry import ConnectorRegistry

    manifest = tmp_path / "empty_connectors.yaml"
    manifest.write_text("{}\n")

    registry = ConnectorRegistry(manifest_path=manifest)

    with pytest.raises(KeyError):
        registry.resolve("not_a_real_connector")


def test_archive_derived_plugin_is_abstract_with_one_method():
    from forecasting_agent.data_server.connectors import ArchiveDerivedPlugin

    class Concrete(ArchiveDerivedPlugin):
        def fetch(self, observed_on: date) -> list:
            return []

    instance = Concrete()
    assert instance.fetch(date(2026, 8, 14)) == []
