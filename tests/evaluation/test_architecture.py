"""Architecture test — the evaluation package's import closure contains no first-party module outside it."""

import ast
import pathlib

PACKAGE_DIR = pathlib.Path(__file__).resolve().parents[2] / "src" / "forecasting_agent" / "evaluation"
FIRST_PARTY_ROOT = "forecasting_agent"
ALLOWED_PREFIX = "forecasting_agent.evaluation"


def _imported_modules(source: str) -> set[str]:
    """Takes Python source text; returns the set of absolute module names it imports."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module is not None:
            names.add(node.module)
    return names


def test_package_directory_is_discoverable() -> None:
    assert PACKAGE_DIR.is_dir()
    assert (PACKAGE_DIR / "pipeline.py").is_file()


def test_no_first_party_import_outside_the_evaluation_package() -> None:
    offenders: list[tuple[str, str]] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        for module in _imported_modules(path.read_text(encoding="utf-8")):
            if module.split(".")[0] == FIRST_PARTY_ROOT and not module.startswith(ALLOWED_PREFIX):
                offenders.append((path.name, module))
    assert offenders == []


def test_no_forbidden_runtime_dependencies_are_imported() -> None:
    forbidden = {"pandas", "scipy", "statsmodels", "requests", "httpx", "logging", "sqlalchemy", "psycopg"}
    offenders: list[tuple[str, str]] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        for module in _imported_modules(path.read_text(encoding="utf-8")):
            if module.split(".")[0] in forbidden:
                offenders.append((path.name, module))
    assert offenders == []


def test_no_module_reaches_for_the_wall_clock() -> None:
    offenders: list[str] = []
    for path in sorted(PACKAGE_DIR.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if "datetime.now(" in source or "date.today(" in source or "time.time(" in source:
            offenders.append(path.name)
    assert offenders == []
