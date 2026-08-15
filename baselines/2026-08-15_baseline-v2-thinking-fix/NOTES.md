# Baseline v2 — post thinking-mode / clean-exit fix

10 Nifty 50 symbols, run against the harness on branch `issue-9-langfuse-tracing-and-e2e-fixes`
(uncommitted changes captured in `uncommitted-changes.patch`, base commit in `git-status.txt`).

## What changed since `2026-08-15_baseline-v1`

v1 was started against a broken pipeline (`ChatDeepSeek` + `deepseek-v4-flash`) that failed
deterministically on any symbol needing a `write_file` structured-output turn — 400 "Thinking
mode does not support this tool_choice". v1 never completed (only RELIANCE.NS partially ran
before a session restart killed it), so it isn't a usable comparison point for signal quality —
only useful as a "this version doesn't run at all" marker.

v2 fixes:
- `src/agents/price-anchor.ts`: `ChatDeepSeek` -> `ChatOpenAI` against DeepSeek's OpenAI-compatible
  endpoint, plus a `createMiddleware` hook forcing `toolChoice: "auto"` on every turn. Keeps
  thinking mode on (forecast quality) while avoiding the forced-tool_choice 400.
- `src/pipeline/single-agent.ts`: `mcpClient.close()` in the pipeline's `finally`.
- `scripts/run-real-pipeline.ts`: `process.exit(0)` after cleanup, since the OTel exporter's
  keep-alive socket otherwise never lets a one-shot CLI run terminate on its own.

## Reading summary.csv

- `status`: pass/fail at the harness level (agent produced a structured signal + validate tier ran).
- `verdict`: the M8 evaluation gate's `VALID`/`INVALID` status (`GateVerdict.status`), not a
  correctness judgment on direction/probability.
- `direction`/`probability`/`confidence`: the agent's own structured signal.
- `elapsed_s`: wall-clock per symbol, thinking mode included.

Full per-symbol stdout (`runs/<symbol>.json`) and stderr stage log (`runs/<symbol>.log`) are kept
so any surprising number can be traced back to the actual tool calls and reasoning.
