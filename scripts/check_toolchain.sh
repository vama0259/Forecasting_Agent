#!/usr/bin/env bash
# Gate for the two-stack toolchain wiring: make/CI/pre-commit must all reach harness/.
set -euo pipefail
fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }

check "Makefile lint target reaches harness"    "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*lint'"
check "Makefile typecheck runs in harness"      "grep -A4 '^lint:' Makefile | grep -q 'pnpm.*typecheck'"
check "Makefile test target reaches harness"    "grep -A4 '^test:' Makefile | grep -q 'pnpm.*test'"
check "Makefile still runs ruff"                "grep -A4 '^lint:' Makefile | grep -q 'ruff check'"
check "Makefile still runs pytest"              "grep -A4 '^test:' Makefile | grep -q 'pytest'"
check "check target composes lint+security+test" "grep -q '^check: lint security test' Makefile"
check "CI defines a harness job"                "grep -q '^  harness:' .github/workflows/ci.yml"
check "CI installs pnpm"                        "grep -q 'pnpm/action-setup' .github/workflows/ci.yml"
check "CI pins Node 24"                         "grep -q \"node-version: '24'\" .github/workflows/ci.yml"
check "CI installs frozen lockfile"             "grep -q 'pnpm install --frozen-lockfile' .github/workflows/ci.yml"
check "CI typechecks the harness"               "grep -q 'pnpm typecheck' .github/workflows/ci.yml"
check "CI tests the harness"                    "grep -q 'pnpm test' .github/workflows/ci.yml"
check "pre-commit has an eslint hook"           "grep -q 'id: harness-eslint' .pre-commit-config.yaml"
check "pre-commit has a prettier hook"          "grep -q 'id: harness-prettier' .pre-commit-config.yaml"
check "pre-commit JS hooks scoped to harness"   "grep -Fq 'files: ^harness/.*\.ts$' .pre-commit-config.yaml"
check "python hooks still present"              "grep -q 'ruff-pre-commit' .pre-commit-config.yaml"

exit "$fail"
