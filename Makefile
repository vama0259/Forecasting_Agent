.PHONY: setup sync lint format test security check all clean

setup:
	uv python install 3.12
	uv sync
	corepack enable pnpm
	cd harness && pnpm install

sync:
	uv sync
	uv run pre-commit install

lint:
	uv run ruff check .
	uv run mypy src/
	cd harness && pnpm lint
	cd harness && pnpm typecheck

format:
	uv run ruff check --fix .
	uv run ruff format .
	cd harness && pnpm format

test:
	uv run pytest tests/ -v
	cd harness && pnpm test

security:
	uv run bandit -r src/ -c pyproject.toml

check: lint security test

all: setup sync check

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache coverage.xml htmlcov/ .venv/
