---
type: adr
date: 2026-08-14
status: decided
parent: "[[Forecasting Agent]]"
---

# Single-Agent End-to-End Baseline (Price Anchor) — Design Spec

**Story:** GitHub #9 — Story 6 (MILESTONE): Single-Agent End-to-End Baseline
**Implements:** ADR-002 (Deep Agents shell), ADR-023 (price anchor agent, M6), ADR-014 (LLM client)
**Milestone:** MVP 1 — Indian Equities & Derivatives — **the critical integration gate**
**Depends on:** #4 ✅ merged · #5 ✅ merged · #6 ✅ merged · #7 ❌ not yet built · #8 ✅ merged

## Scope and a hard boundary

This spec covers the **design only** — `price-anchor.ts` and `single-agent.ts`'s architecture, interfaces, and everything buildable without a sandbox. **It does not implement or test sandbox execution.** Issue #9's own acceptance criteria ("Explore sandbox executes model," "Validate sandbox reproduces results") are gated on #7, which does not exist yet. Building the sandbox-execution path now would mean building against an interface nobody has committed to — the spec instead defines the exact seam #7 must satisfy, so implementation can start the moment #7 lands without redesigning anything.

## What already exists, verified against the real merged code, not assumed

- `cap()` / `CapabilityRegistry` (#4, `harness/src/capabilities/registry.ts`) — resolves `market_data` to the MCP server.
- `market-data-mcp` server (#5, `src/forecasting_agent/data_server/server.py`) — `fetch_ohlcv` tool, real Hampel/point-in-time/cache pipeline.
- `evaluate()` (#6, `src/forecasting_agent/evaluation/pipeline.py`) — MASE/Brier/Sortino/gate, pure functions, no I/O.
- `repository.ts` (#8, `harness/src/storage/repository.ts`) — `saveForecast`, `saveEvalResult`, `saveAgentSignal`; `queryMemory()` is the sole `as_of`-guarded read.
- `langfuse.ts`/`correlation.ts` (#8) — `getLangfuseClient()`, `generateTraceId()`, verified 4-level span nesting.

## Resolving discrepancies between issue #9's text and the accepted ADRs / real packages

1. **`deepagents` is a real, substantial framework — verified its actual API, not assumed.** Installed `deepagents@1.12.3` (ADR-002's chosen package) and inspected its exports directly: `createDeepAgent({ model, backend, tools, stateSchema }).invoke({ messages })`. This is far more than "a basic LangGraph agent node" (the issue's phrasing) — it ships filesystem tools, subagent spawning, memory middleware, and summarization out of the box. Building `price-anchor.ts` as a thin `createDeepAgent()` config, not a hand-rolled LangGraph node — reinventing what the framework already provides would contradict ADR-002 itself.

2. **The sandbox integration point is `deepagents`' own `backend` parameter, not a custom call site — a real architectural finding.** `createDeepAgent`'s own JSDoc example passes `backend: sandbox` directly, and the package exports `BaseSandbox`, `SandboxBackendProtocol`-shaped types, `isSandboxProtocol`, `adaptSandboxProtocol`. **This means #7's Docker sandbox needs to implement `deepagents`' `SandboxBackendProtocol` (`execute()`, `id`, `close()`, per the shape already documented in this session's earlier LangChain research), not sit beside the agent as a separate service the pipeline calls manually.** This is worth surfacing to whoever builds #7 explicitly — it changes what "the sandbox" needs to expose.

3. **`AgentSignal` is the wire format, not an ad-hoc result object.** ADR-023 defines it precisely: `{ direction, probability, confidence, horizon_days, evidence[], dissent? }` — this is simultaneously the debate wire format for #11 (not this story) *and* ADR-011's scoring input. The price agent's output must conform to this shape now, even though #9 never debates, because #6's `evaluate()` and #8's `saveAgentSignal()` are both built to consume it — building something else means a second translation layer nobody asked for.

4. **Model client: `ChatDeepSeek` from `@langchain/deepseek`, verified to exist and export that class.** Matches ADR-014's "client wrapper (`ChatDeepSeek`, key handling, base URL)" and ADR-009's DeepSeek choice. Config comes from `HarnessConfig.llm` (#4's existing schema — `provider`/`model`/`api_key`), not a new config section.

5. **MCP tool loading uses `langchain-mcp-adapters`, not a hand-rolled `cap()` call inside the agent.** Verified during #5's spec work: `MultiServerMCPClient.getTools()` returns LangChain-native tool objects derived directly from the MCP server's schema. `price-anchor.ts` builds its `tools` array this way and passes it to `createDeepAgent({ tools })` — the agent calls `fetch_ohlcv` as a normal tool call, not through a special-cased capability-registry code path. `cap('market_data')` (issue's literal phrasing) resolves *which* MCP server to connect the client to; it is not itself the tool-calling mechanism.

6. **Issue's "1 retry" self-debug requirement is a `deepagents` middleware concern, not hand-written retry logic.** `deepagents` ships `createSubAgentMiddleware`/async subagent patterns and the framework's own execution loop already re-invokes on tool error within a single `.invoke()` call when the model is instructed to retry. Confirming the exact middleware/prompt shape for "1 retry, then stop" is deferred to implementation (needs #7's real error shape to design the retry-trigger condition against) — noted as an open item, not designed blind.

7. **There is currently no way for the TypeScript harness to call `evaluate()` at all — a real, previously-undiscovered architectural gap, not a design choice within this spec's power to resolve alone.** Checked directly: `evaluate()` lives in `src/forecasting_agent/evaluation/`, a pure Python package with "zero first-party imports outside evaluation package" (#6's own stated invariant) — no MCP server, no HTTP wrapper, nothing. `single-agent.ts` is TypeScript. Issue #6's body never addresses how the harness reaches it; issue #9's subtasks say "M8 evaluation scores the model" as if the bridge already exists. It doesn't. Two obvious options, neither designed here since this affects #11 too (the debate protocol also needs to score signals) and shouldn't be decided inside a single story's spec: (a) wrap `evaluate()` as its own MCP server, matching #5's pattern exactly — consistent with ADR-015's "everything external is a capability," but a new service to run; (b) a Node `child_process` call into a small Python CLI wrapper — less infrastructure, but reintroduces the subprocess-boundary error handling #5's MCP approach was chosen specifically to avoid (ADR-013's rationale: "MCP was selected over an HTTP service to keep one integration pattern for all external data"). Flagged on the Kanban as a cross-story architectural decision needed before #9 (or #11) can actually be implemented, not silently assumed away.

## Structure

```
harness/src/agents/
  price-anchor.ts        createDeepAgent() config: model, tools, backend (interface, see decision 2),
                          stateSchema for AgentSignal output
harness/src/pipeline/
  single-agent.ts         orchestrates: fetch data -> agent.invoke() -> [SANDBOX BOUNDARY] ->
                          evaluate() -> repository.save*() -> langfuse trace, wrapping the whole run
harness/tests/e2e/
  single-agent.test.ts     tests everything up to and after the sandbox boundary; the boundary
                          itself is mocked against the SandboxBackendProtocol shape (decision 2),
                          not against real Docker — that's #7's own test suite's job
```

## Data Flow

```
single-agent.ts orchestration, wrapped in one Langfuse trace (forecast_run):
  1. traceId = generateTraceId()                                    [span: forecast_run]
  2. trace = langfuse.trace({ name: 'forecast_run', id: traceId })
  3. mcpClient = MultiServerMCPClient({ market_data: <cap('market_data') config> })
     tools = await mcpClient.getTools()
  4. agent = createDeepAgent({ model: ChatDeepSeek(config.llm), tools, backend: sandbox })
                                                                       [span: debate_round — reused
                                                                        as "agent_turn" here since
                                                                        this story has one agent,
                                                                        not four; #11 adds the
                                                                        multi-agent nesting later]
  5. result = await agent.invoke({ messages: [<prompt: write exp-smoothing forecast for
     RELIANCE.NS>] })
     -- internally, the agent calls fetch_ohlcv via its tools, writes Python, and calls the
        sandbox via `backend` -- all inside this one invoke()                [span: tool_call]
  6. signal: AgentSignal = <parse result into ADR-023's schema>
  7. evalResult = <call evaluate() via whichever bridge decision 7 resolves to -- NOT a direct
     import, evaluate() is Python and this file is TypeScript, no bridge exists yet>
  8. await repository.saveForecast(pool, { ...signal, asOf: <as-of date> })
     await repository.saveAgentSignal(pool, { ...signal, asOf: <as-of date> })
     await repository.saveEvalResult(pool, evalResult)
  9. trace ends; span.update() attaches cost/token fields (issue's "cost tracking" subtask from
     #8, deferred there, lands here since this is the first place a real invoke() produces them)
```

## Testing (design-scope — no sandbox execution tested here)

- `single-agent.test.ts` — mocks `MultiServerMCPClient.getTools()` (same pattern #5 used for `yf.download`) and mocks the `backend` sandbox parameter against the `SandboxBackendProtocol` shape (`execute()`, `id`, `close()`) rather than real Docker. Verifies: the pipeline calls `evaluate()` with the agent's actual output shape, `AgentSignal`'s schema is enforced (a malformed agent response should fail loudly, not silently proceed to storage), all three `repository.save*()` calls happen with a consistent `as_of`, and the Langfuse span hierarchy nests correctly for a single-agent run.
- **Explicitly not tested here, and not claimed to be:** whether `deepagents`' real execution loop actually calls a real Docker container correctly, whether the "1 retry" self-debug behavior triggers correctly on a real sandbox error, whether the agent's generated Python code is actually sound. All three need #7 to exist first.

## Out of Scope (this design pass)

Any implementation touching `backend`/sandbox execution (blocked on #7) · the harness-to-`evaluate()` bridge (decision 7 — blocked on a cross-story architectural decision, not this story's alone) · the "1 retry, self-debug" middleware's exact trigger condition (needs #7's real error shape) · release tagging (`v0.1.0-alpha` — issue's own Release Gate subtask, happens after implementation, not design) · #11's multi-agent debate nesting (this story is one agent, `debate_round`/`agent_turn` spans are reused/collapsed for a single participant, not genuinely multi-round).

## Review Log

Authored inline (Claude, this session — no subagent dispatch, no Codex delegation). Design-only pass; `reviewing-specs`' full verify→ponytail→grill loop to two consecutive `APPROVED` deferred until #7 exists and the sandbox interface can be verified against a real implementation rather than a documented type shape — reviewing a spec whose central integration point is unbuildable would produce approval on an assumption, not evidence. Flagging this explicitly rather than running the loop for form's sake.

**Partial verification pass run anyway, on what's actually checkable now:** confirmed `deepagents@1.12.3`, `@langchain/langgraph@1.4.9`, `@langchain/deepseek@1.1.7` genuinely exist and export what's claimed (`createDeepAgent`, `ChatDeepSeek`); confirmed `repository.ts`'s `saveForecast`/`saveAgentSignal`/`saveEvalResult` exist with those exact names. **Caught one real defect in my own first draft**: the Data Flow section called `evaluate(signal, historicalFoldData)` as if it were an in-process call — checked `evaluate()`'s real signature and location (`src/forecasting_agent/evaluation/pipeline.py`, pure Python, "zero first-party imports outside evaluation package") and found there is **no bridge from the TypeScript harness to it at all** — not built by #6, not addressed by #9's issue text either. This is now decision 7, and it's a cross-story gap (also blocks #11), not something this spec resolves alone. Flagged on the Kanban.

Fences balanced, decision cross-references consistent, structure/data-flow/testing sections checked for internal consistency after all edits.
