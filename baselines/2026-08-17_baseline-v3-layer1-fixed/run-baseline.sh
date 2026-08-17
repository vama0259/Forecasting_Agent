#!/bin/bash
# Re-runs the real end-to-end single-agent pipeline over symbols.txt so the agent finally has a
# Layer-1 MASE scored by the FIXED evaluator (79c27e8). Every earlier sweep predates that commit
# and scored a fixed baseline instead of the agent's own forecast, so none of them are comparable
# to scripts/run_baseline_ladder.py. One symbol at a time: SandboxManager's Semaphore(2) is
# per-process, so parallel pipeline processes would oversubscribe the Docker sandbox.
set -uo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="/home/varunmalhotra/Desktop/Forecasting_Agent/harness"
RUNS_DIR="$BASELINE_DIR/runs"
mkdir -p "$RUNS_DIR"

echo "symbol,status,verdict,direction,probability,confidence,elapsed_s" > "$BASELINE_DIR/summary.csv"

cd "$HARNESS_DIR" || exit 1

while IFS= read -r SYMBOL; do
  [ -z "$SYMBOL" ] && continue
  echo "=== [$(date -Iseconds)] starting $SYMBOL ==="
  START=$(date +%s)
  pnpm exec tsx --env-file=../.env scripts/run-real-pipeline.ts "$SYMBOL" \
    > "$RUNS_DIR/$SYMBOL.json" 2> "$RUNS_DIR/$SYMBOL.log"
  EXIT_CODE=$?
  END=$(date +%s)
  ELAPSED=$((END - START))

  if [ "$EXIT_CODE" -eq 0 ] && [ -s "$RUNS_DIR/$SYMBOL.json" ]; then
    STATUS="pass"
  else
    STATUS="fail"
  fi
  echo "$SYMBOL,$STATUS,,,,,$ELAPSED" >> "$BASELINE_DIR/summary.csv"
  echo "=== [$(date -Iseconds)] finished $SYMBOL: $STATUS (${ELAPSED}s) ==="
done < "$BASELINE_DIR/symbols.txt"

echo "=== baseline run complete ==="
