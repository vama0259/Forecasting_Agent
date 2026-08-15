#!/bin/bash
# Runs the real end-to-end pipeline for every symbol in symbols.txt, saving each run's
# structured RESULT (stdout) and full stage log (stderr) separately, plus a summary.json
# at the end. One symbol at a time -- SandboxManager's own Semaphore(2) is per-process, so
# running many pipeline processes concurrently would oversubscribe the Docker sandbox.
set -uo pipefail

BASELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="/home/varunmalhotra/Desktop/Forecasting_Agent/harness"
RUNS_DIR="$BASELINE_DIR/runs"
mkdir -p "$RUNS_DIR"

LLM_API_KEY=$(grep -E '^LLM_API_KEY=' "$HARNESS_DIR/.env" | cut -d= -f2)
LLM_MODEL=$(grep -E '^LLM_MODEL=' "$HARNESS_DIR/.env" | cut -d= -f2)
STORAGE_CONNECTION_STRING=$(grep -E '^STORAGE_CONNECTION_STRING=' "$HARNESS_DIR/.env" | cut -d= -f2)
LANGFUSE_PUBLIC_KEY=$(grep -E '^LANGFUSE_PUBLIC_KEY=' "$HARNESS_DIR/.env" | cut -d= -f2 | tr -d '"')
LANGFUSE_SECRET_KEY=$(grep -E '^LANGFUSE_SECRET_KEY=' "$HARNESS_DIR/.env" | cut -d= -f2 | tr -d '"')
LANGFUSE_BASE_URL=$(grep -E '^LANGFUSE_BASE_URL=' "$HARNESS_DIR/.env" | cut -d= -f2 | tr -d '"')
export LLM_API_KEY LLM_MODEL STORAGE_CONNECTION_STRING LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY LANGFUSE_BASE_URL

echo "symbol,status,verdict,direction,probability,confidence,elapsed_s" > "$BASELINE_DIR/summary.csv"

cd "$HARNESS_DIR" || exit 1

while IFS= read -r SYMBOL; do
  [ -z "$SYMBOL" ] && continue
  echo "=== [$(date -Iseconds)] starting $SYMBOL ==="
  START=$(date +%s)
  ~/opt/node24/bin/node --experimental-strip-types --experimental-loader ./scripts/ts-resolve-loader.mjs \
    scripts/run-real-pipeline.ts "$SYMBOL" \
    > "$RUNS_DIR/$SYMBOL.json" 2> "$RUNS_DIR/$SYMBOL.log"
  EXIT_CODE=$?
  END=$(date +%s)
  ELAPSED=$((END - START))

  if [ "$EXIT_CODE" -eq 0 ] && [ -s "$RUNS_DIR/$SYMBOL.json" ]; then
    STATUS="pass"
    VERDICT=$(python3 -c "import json; d=json.load(open('$RUNS_DIR/$SYMBOL.json')); print(d['evalResult']['verdict']['status'])" 2>/dev/null || echo "?")
    DIRECTION=$(python3 -c "import json; d=json.load(open('$RUNS_DIR/$SYMBOL.json')); print(d['signal']['direction'])" 2>/dev/null || echo "?")
    PROBABILITY=$(python3 -c "import json; d=json.load(open('$RUNS_DIR/$SYMBOL.json')); print(d['signal']['probability'])" 2>/dev/null || echo "?")
    CONFIDENCE=$(python3 -c "import json; d=json.load(open('$RUNS_DIR/$SYMBOL.json')); print(d['signal']['confidence'])" 2>/dev/null || echo "?")
  else
    STATUS="fail"
    VERDICT="-"
    DIRECTION="-"
    PROBABILITY="-"
    CONFIDENCE="-"
  fi

  echo "$SYMBOL,$STATUS,$VERDICT,$DIRECTION,$PROBABILITY,$CONFIDENCE,$ELAPSED" >> "$BASELINE_DIR/summary.csv"
  echo "=== [$(date -Iseconds)] finished $SYMBOL: $STATUS (${ELAPSED}s) ==="
done < "$BASELINE_DIR/symbols.txt"

echo "=== baseline run complete ==="
cat "$BASELINE_DIR/summary.csv"
