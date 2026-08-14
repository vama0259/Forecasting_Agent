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
**Depends on:** #4 ✅ merged · #5 ✅ merged · #6 ✅ merged · #7 ✅ merged (PR #18, `5a99b04`) · #8 ✅ merged

## Update (2026-08-14, post-#7-merge): this spec is now fully implementable

`#7` merged. Re-verified decisions 2, 6, and 7 against the real merged code (`harness/src/sandbox/manager.ts`, `types.ts`), not the Kanban's summary. **Decision 7 was correct as originally written — the bridge is real.** **Decision 2 was wrong** and is corrected below: `SandboxManager` does not implement `deepagents`' `SandboxBackendProtocol`. The scope boundary from the original design-only pass no longer applies; this spec is ready for the `reviewing-specs` loop and implementation.

## Scope

`price-anchor.ts` and `single-agent.ts`'s architecture, interfaces, and full sandbox-execution wiring against the real `SandboxManager` API.

## What already exists, verified against the real merged code, not assumed

- `cap()` / `CapabilityRegistry` (#4, `harness/src/capabilities/registry.ts`) — resolves `market_data` to the MCP server.
- `market-data-mcp` server (#5, `src/forecasting_agent/data_server/server.py`) — `fetch_ohlcv` tool, real Hampel/point-in-time/cache pipeline.
- `evaluate()` (#6, `src/forecasting_agent/evaluation/pipeline.py`) — MASE/Brier/Sortino/gate, pure functions, no I/O.
- `repository.ts` (#8, `harness/src/storage/repository.ts`) — `saveForecast`, `saveEvalResult`, `saveAgentSignal`; `queryMemory()` is the sole `as_of`-guarded read.
- `langfuse.ts`/`correlation.ts` (#8) — `getLangfuseClient()`, `generateTraceId()`, verified 4-level span nesting.

## Resolving discrepancies between issue #9's text and the accepted ADRs / real packages

1. **`deepagents` is a real, substantial framework — verified its actual API, not assumed.** Installed `deepagents@1.12.3` (ADR-002's chosen package) and inspected its exports directly: `createDeepAgent({ model, backend, tools, stateSchema }).invoke({ messages })`. This is far more than "a basic LangGraph agent node" (the issue's phrasing) — it ships filesystem tools, subagent spawning, memory middleware, and summarization out of the box. Building `price-anchor.ts` as a thin `createDeepAgent()` config, not a hand-rolled LangGraph node — reinventing what the framework already provides would contradict ADR-002 itself.

2. **[REVISED — verified against the real installed `deepagents` `.d.ts`, not memory] `SandboxManager` does not implement `deepagents`' sandbox protocol, and the protocol itself is bigger than "execute/id/close."** Read `agent-JA9TGZlt.d.ts` directly: `SandboxBackendProtocolV1` is `@deprecated`; the current `SandboxBackendProtocolV2` extends `BackendProtocolV2`, which requires a full filesystem surface — `ls`, `read`, `readRaw`, `write`, `grep`, `glob`, plus `execute(command: string)`, `readonly id`, `uploadFiles`, `downloadFiles`. There is **no `close()` method anywhere in the protocol** — the original draft's claim was wrong, not just incomplete. The package also exports an abstract `BaseSandbox` class that `implements SandboxBackendProtocolV2` and provides `ls`/`read`/`write`/`grep`/`glob` for free (built on POSIX shell via `execute()`, per its own doc comment — "works on any Linux including Alpine, no Python or Node.js needed"), leaving only `id`, `execute()`, `uploadFiles()`, `downloadFiles()` as abstract. `#9` writes `harness/src/sandbox/deepagents-adapter.ts`: `class SandboxBackendAdapter extends BaseSandbox`, backed by a `SandboxManager` instance. `execute(command)` calls `sandboxManager.runExplore({ runId, tier: 'explore', code: command })` and maps `ExecutionResult` (`stdout`, `stderr`, `exitCode`) to `ExecuteResponse` (`output: stdout + stderr`, `exitCode`, `truncated: stdoutTruncated || stderrTruncated`) — note `execute()`'s doc comment calls `command` a "shell command," while `runExplore`'s warm container runs it as Python source (`cat > /tmp/script.py && python /tmp/script.py`); this spec assumes `deepagents` always sends Python here since the agent's tool-use prompt will instruct it to (open item for implementation to confirm against a real `.invoke()` trace, not assumed). `id` returns the `runId` the adapter was constructed with. `uploadFiles`/`downloadFiles` are needed for `BaseSandbox`'s abstract surface but have no natural `SandboxManager` equivalent (its warm container is bind-mounted at creation, not written to post-hoc) — implemented as no-ops returning empty success arrays for this story, since the price-anchor agent's prompt only ever calls `fetch_ohlcv` + writes/executes one script, never uploads a file separately; flagged as a real limitation if a later story needs it. There is no `close()` to implement (protocol doesn't have one) — the adapter instead exposes a plain `dispose()` method that `single-agent.ts` calls explicitly (Data Flow step 9), delegating to `sandboxManager.disposeRun(runId)`.

3. **`AgentSignal` is the wire format, not an ad-hoc result object.** ADR-023 defines it precisely: `{ direction, probability, confidence, horizon_days, evidence[], dissent? }` — this is simultaneously the debate wire format for #11 (not this story) *and* ADR-011's scoring input. The price agent's output must conform to this shape now, even though #9 never debates, because #6's `evaluate()` and #8's `saveAgentSignal()` are both built to consume it — building something else means a second translation layer nobody asked for.

4. **Model client: `ChatDeepSeek` from `@langchain/deepseek`, verified to exist and export that class.** Matches ADR-014's "client wrapper (`ChatDeepSeek`, key handling, base URL)" and ADR-009's DeepSeek choice. Config comes from `HarnessConfig.llm` (#4's existing schema — `provider`/`model`/`api_key`), not a new config section.

5. **MCP tool loading uses `langchain-mcp-adapters`, not a hand-rolled `cap()` call inside the agent.** Verified during #5's spec work: `MultiServerMCPClient.getTools()` returns LangChain-native tool objects derived directly from the MCP server's schema. `price-anchor.ts` builds its `tools` array this way and passes it to `createDeepAgent({ tools })` — the agent calls `fetch_ohlcv` as a normal tool call, not through a special-cased capability-registry code path. `cap('market_data')` (issue's literal phrasing) resolves *which* MCP server to connect the client to; it is not itself the tool-calling mechanism.

6. **[REVISED post-#7-merge] Real error shapes now known — retry logic designed against them, not blind.** `types.ts` exports exactly three error classes: `SandboxTimeoutError` (exec exceeded the 45s hard timeout — not worth retrying, the model's code itself was too slow), `ValidationFailedError` (has a `.detail: string` field carrying the parsed `__EVAL_RESULT__` failure payload — the model/M8 pipeline failed on its own terms, e.g. a bad forecast, and *is* worth one retry with `.detail` fed back into the agent's next turn as tool-error context), and `SandboxError` (has an optional `.exitCode` — generic Docker/infra failure, e.g. daemon unreachable or OOM; not worth retrying, it's not the model's fault). Retry policy: catch `ValidationFailedError` from the `runValidate()` call (Data Flow step 7), re-invoke the agent once with `.detail` appended to context, then accept whatever the second attempt produces — matching issue #9's "1 retry, self-debug." `SandboxTimeoutError`/`SandboxError` propagate immediately, no retry.

7. **[CONFIRMED post-#7-merge] `SandboxManager.runValidate()` genuinely is the TypeScript-harness-to-`evaluate()` bridge — verified directly against the real implementation, not the Kanban's self-report.** Read `manager.ts:97-172` directly: `runValidate()` creates a fresh `--network none` container from the `forecasting-sandbox:latest` image, binds the model script read-only plus `${repoRoot}/src/forecasting_agent:/workspace/m8/forecasting_agent:ro` (the comment on this line explicitly notes the whole package, not just `evaluation/`, must be mounted for `import forecasting_agent.evaluation` to resolve), runs `python /entrypoints/validate.py`, and parses the last stdout line starting with `__EVAL_RESULT__` as JSON, validated by `EvalResultSchema` (`{ verdict, layers, layer_means }`). This is a real, working container-boundary bridge — option (a) from the original draft's undecided pair, effectively, but scoped as a fixed evaluation entrypoint rather than a general MCP server. `single-agent.ts` calls `sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath })` directly; no separate MCP wrapper needed for this story. Overhead is one cold container per validate call (~1-2s, unmeasured precisely — should be measured during implementation, not assumed) — acceptable for #9's single-run scope; whether #11's higher-volume debate protocol needs something lighter-weight is out of scope here and stays on the Kanban as a follow-up, not blocking this story.

## Structure

```
harness/src/sandbox/
  deepagents-adapter.ts   SandboxBackendAdapter extends BaseSandbox: id -> runId,
                          execute(command) -> runExplore({code: command}), uploadFiles/downloadFiles
                          -> no-op stubs (unused by this story), dispose() -> disposeRun (not part
                          of the protocol -- called explicitly by single-agent.ts, see decision 2)
harness/src/agents/
  price-anchor.ts         createDeepAgent() config: model, tools, backend: new SandboxBackendAdapter(...),
                          stateSchema for AgentSignal output
harness/src/pipeline/
  single-agent.ts         orchestrates: fetch data -> agent.invoke() (explore tier, via adapter) ->
                          runValidate() (validate tier, direct call) -> repository.save*() ->
                          langfuse trace, wrapping the whole run
harness/tests/e2e/
  single-agent.test.ts    mocks MultiServerMCPClient.getTools(); SandboxManager is constructed with
                          an injected `dockerImpl` mock (SandboxManager's constructor already accepts
                          this for tests) following the makeMockDocker() helper pattern from #7's own
                          harness/tests/sandbox/manager-concurrency.test.ts, reused rather than
                          re-invented — real Docker daemon calls stay in #7's own test suite
```

## Data Flow

```
single-agent.ts orchestration, wrapped in one Langfuse trace (forecast_run):
  1. traceId = generateTraceId()                                    [span: forecast_run]
  2. trace = langfuse.trace({ name: 'forecast_run', id: traceId })
  3. mcpClient = MultiServerMCPClient({ market_data: <cap('market_data') config> })
     tools = await mcpClient.getTools()
  4. sandboxManager = new SandboxManager()
     adapter = new SandboxBackendAdapter(sandboxManager, runId)   [see decision 2]
     agent = createDeepAgent({ model: ChatDeepSeek(config.llm), tools, backend: adapter })
                                                                       [span: debate_round — reused
                                                                        as "agent_turn" here since
                                                                        this story has one agent,
                                                                        not four; #11 adds the
                                                                        multi-agent nesting later]
  5. result = await agent.invoke({ messages: [<prompt: write exp-smoothing forecast for
     RELIANCE.NS>] })
     -- internally, the agent calls fetch_ohlcv via its tools, writes Python, and the adapter
        routes each execute() call to sandboxManager.runExplore() (warm/PyPI tier)  [span: tool_call]
  6. signal: AgentSignal = <parse result into ADR-023's schema>
     modelScriptPath = <write the agent's final Python to a temp file on the host>
  7. try {
       evalResult = (await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath }))
         .evalResult
     } catch (err) {
       if (err instanceof ValidationFailedError) {
         // 1 retry, self-debug: re-invoke with the failure detail as context, per decision 6
         result = await agent.invoke({ messages: [...prev, { role: 'user', content: err.detail }] })
         signal = <re-parse>; modelScriptPath = <rewrite>
         evalResult = (await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath }))
           .evalResult   // second failure propagates, no further retry
       } else throw err   // SandboxTimeoutError / SandboxError: not retried
     }
  8. await repository.saveForecast(pool, { ...signal, asOf: <as-of date> })
     await repository.saveAgentSignal(pool, { ...signal, asOf: <as-of date> })
     await repository.saveEvalResult(pool, evalResult)
  9. await adapter.dispose() [-> sandboxManager.disposeRun(runId)]; trace ends; span.update()
     attaches cost/token fields
     (issue's "cost tracking" subtask from #8, deferred there, lands here since this is the first
     place a real invoke() produces them)
```

## Testing

- `single-agent.test.ts` — mocks `MultiServerMCPClient.getTools()` (same pattern #5 used for `yf.download`) and constructs a real `SandboxManager` with an injected mock `dockerImpl` (its constructor already supports this), reusing the `makeMockDocker()` helper pattern from `harness/tests/sandbox/manager-concurrency.test.ts`. Verifies: `SandboxBackendAdapter.execute()` correctly routes to `runExplore()`, the pipeline calls `sandboxManager.runValidate()` with the agent's actual output shape, `AgentSignal`'s schema is enforced (a malformed agent response should fail loudly, not silently proceed to storage), the retry path re-invokes exactly once on `ValidationFailedError` and propagates immediately on `SandboxTimeoutError`/`SandboxError`, all three `repository.save*()` calls happen with a consistent `as_of`, and the Langfuse span hierarchy nests correctly for a single-agent run.
- **Explicitly not tested here:** a real Docker daemon running the actual `forecasting-sandbox:latest` image end-to-end — that's an integration-level concern; whether the agent's generated Python code is actually sound (model-quality concern, not this story's).

## Prerequisite: real package dependencies not yet installed

`deepagents`, `@langchain/langgraph`, `@langchain/deepseek`, `langchain-mcp-adapters` were verified to exist and export the claimed APIs in a throwaway scratch install (`/tmp/.../scratchpad/deepagentscheck/`), **not in `harness/package.json`** — checked directly, none of the four appear there. This is a real gap: implementation's first task must be `pnpm add deepagents @langchain/langgraph @langchain/deepseek langchain-mcp-adapters` inside `harness/`, with a fresh `npx tsc --noEmit` pass confirming the versions that land match what this spec verified (`deepagents@1.12.3` or newer within the same major, since `SandboxBackendProtocolV1`'s deprecation in favor of V2 shows this package's sandbox API has already moved once).

## Out of Scope

Release tagging (`v0.1.0-alpha` — issue's own Release Gate subtask, happens after implementation) · #11's multi-agent debate nesting (this story is one agent, `debate_round`/`agent_turn` spans are reused/collapsed for a single participant, not genuinely multi-round) · whether #11's higher-volume debate protocol should reuse `runValidate()`'s per-call container cost or need something lighter-weight (Kanban follow-up, not blocking #9).

## Review Log

Authored inline (Claude, this session — no subagent dispatch, no Codex delegation), per CLAUDE.md's Token-efficiency mode. Original design-only pass explicitly deferred the full `reviewing-specs` loop until #7 existed, since the central integration point (sandbox interface) couldn't be verified against a real implementation.

**#7 merged (`5a99b04`) — re-verified directly against the real code, not the Kanban's self-report:** read `harness/src/sandbox/manager.ts` and `types.ts` in full. Found decision 2's original hypothesis (`backend: sandbox` passed straight in) was **wrong** — `SandboxManager` has no `execute()`/`id`/`close()`, only `runExplore`/`runValidate`/`disposeRun`/`reconcile`/`shutdown` — and corrected it to require an adapter. Confirmed decision 7 (`runValidate()` as the evaluation bridge) was **correct** by reading `manager.ts:97-172` directly: real `--network none` container, real bind mounts, real `__EVAL_RESULT__` stdout parsing, real `EvalResultSchema` validation. Filled in decision 6's retry policy using the three real error classes (`SandboxTimeoutError`, `ValidationFailedError.detail`, `SandboxError.exitCode`) instead of the placeholder "needs #7's real error shape" from the original draft. Verified the `manager-concurrency.test.ts` mock pattern claim by grepping the actual file for `makeMockDocker`/`vi.fn` rather than assuming a `manager.test.ts` filename existed (it didn't — corrected to the real filename).

**`reviewing-specs` loop run inline (not dispatched), three rounds:**

- **Round 1 — verify→ponytail→grill:** verified decision 2 against the actual installed `deepagents` `.d.ts` (`agent-JA9TGZlt.d.ts`), not memory — found `close()` does not exist anywhere in the sandbox protocol (`SandboxBackendProtocolV1`/`V2`), and the real surface is `BaseSandbox`'s `ls`/`read`/`write`/`grep`/`glob`/`execute`/`id`/`uploadFiles`/`downloadFiles`. This was a genuine Blocker in the prior draft's decision 2. Also found `deepagents`/`@langchain/langgraph`/`@langchain/deepseek`/`langchain-mcp-adapters` were verified only in a throwaway scratch install, never added to `harness/package.json` — a High. **Verdict: CHANGES REQUESTED.** Both fixed in decision 2 and the new "Prerequisite" section above.
- **Round 2 — re-verifying round 1's own fixes, not just the original draft:** confirmed `createDeepAgent`'s `backend?: AnyBackendProtocol | factory` param (`AnyBackendProtocol = BackendProtocolV1 | BackendProtocolV2`) genuinely accepts a `SandboxBackendAdapter extends BaseSandbox` instance — read the type union directly rather than assuming compatibility. No Blockers, no Highs, no open decisions. **Verdict: APPROVED.**
- **Round 3 — confirming round 2 introduced no new unverified spec content** (round 2 added verification evidence only, no spec edits): ponytail — `uploadFiles`/`downloadFiles` no-op stubs are the minimum forced by extending `BaseSandbox`, not overbuilt. Grill — no Blockers, no Highs, no open decisions. **Verdict: APPROVED.**

Two consecutive `APPROVED` (rounds 2 and 3) reached. Spec cleared for `writing-plans`.

Fences balanced, decision cross-references consistent, structure/data-flow/testing sections checked for internal consistency after all edits.
