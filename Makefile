.PHONY: setup sync lint format test security check all clean

setup:
	uv python install 3.12
	uv sync

sync:
	uv sync
	uv run pre-commit install

lint:
	uv run ruff check .
	uv run mypy src/ tests/evaluation/

format:
	uv run ruff check --fix .
	uv run ruff format .

test:
	uv run pytest tests/ -v

security:
	uv run bandit -r src/ -c pyproject.toml

check: lint security test

all: setup sync check

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache coverage.xml htmlcov/ .venv/
