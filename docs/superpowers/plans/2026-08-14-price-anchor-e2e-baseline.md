# Price Anchor End-to-End Baseline (#9) Implementation Plan

> **For agentic workers:** implementation goes to Gemini via `agy` (`gemini-delegated-implementation`), one task at a time, verified inline after each task — not executed by this plan's author directly. Do not run tests yourself while building this plan; each task carries the exact test Gemini must get green.

**Goal:** Build the single-agent (price anchor) end-to-end forecasting pipeline: fetch market data via MCP tools, run a `deepagents`-based agent that writes and executes forecasting code in the `#7` Docker sandbox, validate/score the result via `evaluate()` (also through the sandbox), and persist everything to Postgres with a Langfuse trace.

**Architecture:** `harness/src/sandbox/deepagents-adapter.ts` bridges `#7`'s `SandboxManager` to `deepagents`' `BaseSandbox` protocol. `harness/src/agents/price-anchor.ts` is a thin `createDeepAgent()` config using that adapter as `backend`. `harness/src/pipeline/single-agent.ts` orchestrates: MCP tools → agent.invoke() → validate → retry-once-on-failure → persist → trace.

**Tech Stack:** TypeScript/Node (harness), `deepagents`, `@langchain/langgraph`, `@langchain/deepseek`, `langchain-mcp-adapters`, `dockerode` (already present via `#7`), `pg`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-08-14-price-anchor-e2e-baseline-design.md` (two consecutive `APPROVED` via inline `reviewing-specs`, round 4 after post-approval fixes — read this doc's decisions 1-7 before touching any task; this plan does not restate them, only cites the file/line seams).

## Global Constraints

- Every new file gets a one-line top-of-file abstract comment; every exported function/class gets a one-line input/output comment. No multi-line docstrings (CLAUDE.md hard rule).
- `pnpm lint` and `pnpm typecheck` must pass in `harness/` after every task — Gemini runs these itself as part of `mode="accept-edits"`, not deferred to a later task.
- No task pushes, opens a PR, or touches the Obsidian vault — that happens after all tasks are verified inline, on explicit go-ahead.
- Tests use `vitest`, mocking `dockerode` via the `dockerImpl` constructor param `SandboxManager` already exposes (`harness/src/sandbox/manager.ts:62`) — never a real Docker daemon in this plan's own tests (that's `#7`'s test suite's job).
- The `MultiServerMCPClient` constructor-shape claim (spec's decision 5 / open item) is unverified going into Task 1 — Task 1's own `tsc --noEmit` pass is what confirms or corrects it, not an assumption carried into later tasks.

---

## Task 1: Install and verify the four new dependencies

**Files:**
- Modify: `harness/package.json`
- Create: `harness/scratch-verify.ts` (temporary, deleted at the end of this task — not committed)

**Interfaces:**
- Produces: confirmed real export names/signatures for `createDeepAgent`, `BaseSandbox`, `AnyBackendProtocol`, `ChatDeepSeek`, `MultiServerMCPClient` that every later task relies on by name.

- [ ] **Step 1: Add the dependencies**

```bash
cd harness && pnpm add deepagents @langchain/langgraph @langchain/deepseek langchain-mcp-adapters
```

- [ ] **Step 2: Write a throwaway type-check script exercising every import this plan relies on**

```typescript
// harness/scratch-verify.ts -- deleted before commit, not part of the codebase
import { createDeepAgent, BaseSandbox } from 'deepagents';
import type { AnyBackendProtocol, ExecuteResponse, FileUploadResponse, FileDownloadResponse } from 'deepagents';
import { ChatDeepSeek } from '@langchain/deepseek';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';

class Probe extends BaseSandbox {
  readonly id = 'probe';
  execute(_command: string): Promise<ExecuteResponse> {
    return Promise.resolve({ output: '', exitCode: 0, truncated: false });
  }
  uploadFiles(_files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return Promise.resolve([]);
  }
  downloadFiles(_paths: string[]): Promise<FileDownloadResponse[]> {
    return Promise.resolve([]);
  }
}

const backend: AnyBackendProtocol = new Probe();
void createDeepAgent({ model: new ChatDeepSeek({ apiKey: 'x', model: 'deepseek-chat' }), backend });
void new MultiServerMCPClient({ market: { command: 'node', args: ['x.js'] } });
```

- [ ] **Step 3: Type-check it**

Run: `cd harness && npx tsc --noEmit scratch-verify.ts`
Expected: `PASS` (zero errors). If `MultiServerMCPClient`'s constructor shape errors, read the actual error and fix the shape in this scratch file until it compiles — this is the real, load-bearing verification the spec's open item asked for. Record whatever the real working shape turns out to be; Task 4 depends on it verbatim.

- [ ] **Step 4: Delete the scratch file**

```bash
rm harness/scratch-verify.ts
```

- [ ] **Step 5: Commit the dependency addition**

```bash
git add harness/package.json harness/pnpm-lock.yaml
git commit -m "chore(harness): add deepagents, langgraph, deepseek, mcp-adapters deps (#9)"
```

---

## Task 2: `SandboxBackendAdapter` — bridge `SandboxManager` to `deepagents`' `BaseSandbox`

**Files:**
- Create: `harness/src/sandbox/deepagents-adapter.ts`
- Test: `harness/tests/sandbox/deepagents-adapter.test.ts`

**Interfaces:**
- Consumes: `SandboxManager` (`harness/src/sandbox/manager.ts`) — `runExplore(req: ExecutionRequest): Promise<ExecutionResult>`, `disposeRun(runId: string): Promise<void>`. `ExecutionRequest` / `ExecutionResult` types from `harness/src/sandbox/types.ts`.
- Produces: `SandboxBackendAdapter` class — `constructor(manager: SandboxManager, runId: string)`, `readonly id: string`, `execute(command: string): Promise<ExecuteResponse>`, `uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]>`, `downloadFiles(paths: string[]): Promise<FileDownloadResponse[]>`, `dispose(): Promise<void>` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/sandbox/deepagents-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxBackendAdapter } from '../../src/sandbox/deepagents-adapter.js';
import type { SandboxManager } from '../../src/sandbox/manager.js';

function makeMockManager(): SandboxManager {
  return {
    runExplore: vi.fn().mockResolvedValue({
      stdout: 'hello\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
      durationMs: 5,
    }),
    disposeRun: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxManager;
}

describe('SandboxBackendAdapter', () => {
  it('exposes the constructed runId as id', () => {
    const adapter = new SandboxBackendAdapter(makeMockManager(), 'run-123');
    expect(adapter.id).toBe('run-123');
  });

  it('execute() routes to runExplore with the runId and code, and maps the result', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.execute('print("hi")');

    expect(manager.runExplore).toHaveBeenCalledWith({
      runId: 'run-123',
      tier: 'explore',
      code: 'print("hi")',
    });
    expect(result).toEqual({ output: 'hello\n', exitCode: 0, truncated: false });
  });

  it('execute() combines stdout+stderr into output and ORs the truncation flags', async () => {
    const manager = makeMockManager();
    (manager.runExplore as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'out',
      stderr: 'err',
      stdoutTruncated: true,
      stderrTruncated: false,
      exitCode: 1,
      durationMs: 5,
    });
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.execute('boom');

    expect(result).toEqual({ output: 'outerr', exitCode: 1, truncated: true });
  });

  it('uploadFiles/downloadFiles return empty success arrays (no-op for this story)', async () => {
    const adapter = new SandboxBackendAdapter(makeMockManager(), 'run-123');
    await expect(adapter.uploadFiles([['a.txt', new Uint8Array()]])).resolves.toEqual([]);
    await expect(adapter.downloadFiles(['a.txt'])).resolves.toEqual([]);
  });

  it('dispose() delegates to manager.disposeRun with the constructed runId', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');
    await adapter.dispose();
    expect(manager.disposeRun).toHaveBeenCalledWith('run-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/sandbox/deepagents-adapter.test.ts`
Expected: `FAIL` — `Cannot find module '../../src/sandbox/deepagents-adapter.js'`

- [ ] **Step 3: Implement**

```typescript
// harness/src/sandbox/deepagents-adapter.ts
// SandboxBackendAdapter: bridges #7's SandboxManager to deepagents' BaseSandbox protocol
// (execute/id/uploadFiles/downloadFiles) per ADR-002/021 -- see spec decision 2.

import { BaseSandbox } from 'deepagents';
import type { ExecuteResponse, FileUploadResponse, FileDownloadResponse } from 'deepagents';
import type { SandboxManager } from './manager.js';

// Bridges a SandboxManager instance to deepagents' BaseSandbox for one agent run.
export class SandboxBackendAdapter extends BaseSandbox {
  readonly id: string;
  readonly #manager: SandboxManager;

  // Takes a SandboxManager and the run's id; returns an adapter scoped to that run's warm container.
  constructor(manager: SandboxManager, runId: string) {
    super();
    this.#manager = manager;
    this.id = runId;
  }

  // Takes Python source as a shell "command" string; returns its ExecuteResponse via the explore tier.
  async execute(command: string): Promise<ExecuteResponse> {
    const result = await this.#manager.runExplore({ runId: this.id, tier: 'explore', code: command });
    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
      truncated: result.stdoutTruncated || result.stderrTruncated,
    };
  }

  // Takes nothing meaningful (no SandboxManager equivalent); returns an empty success array.
  uploadFiles(_files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return Promise.resolve([]);
  }

  // Takes nothing meaningful (no SandboxManager equivalent); returns an empty success array.
  downloadFiles(_paths: string[]): Promise<FileDownloadResponse[]> {
    return Promise.resolve([]);
  }

  // Takes nothing; returns void after removing this run's warm container via the manager.
  async dispose(): Promise<void> {
    await this.#manager.disposeRun(this.id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && pnpm vitest run tests/sandbox/deepagents-adapter.test.ts`
Expected: `PASS` (5/5)

- [ ] **Step 5: Lint/typecheck**

Run: `cd harness && pnpm lint && pnpm typecheck`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add harness/src/sandbox/deepagents-adapter.ts harness/tests/sandbox/deepagents-adapter.test.ts
git commit -m "feat(harness): add SandboxBackendAdapter bridging SandboxManager to deepagents (#9)"
```

---

## Task 3: `price-anchor.ts` — the `createDeepAgent()` config

**Files:**
- Create: `harness/src/agents/price-anchor.ts`
- Test: `harness/tests/agents/price-anchor.test.ts`

**Interfaces:**
- Consumes: `SandboxBackendAdapter` (Task 2). `HarnessConfig['llm']` (`harness/src/config.ts:16-20` — `{provider, model, api_key}`). LangChain `StructuredTool[]` (produced by `MultiServerMCPClient.getTools()`, wired in Task 4 — this task accepts `tools` as a parameter, it does not fetch them itself).
- Produces: `buildPriceAnchorAgent(params: { llmConfig: HarnessConfig['llm']; tools: StructuredTool[]; backend: SandboxBackendAdapter }): ReturnType<typeof createDeepAgent>` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/agents/price-anchor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildPriceAnchorAgent } from '../../src/agents/price-anchor.js';
import { SandboxBackendAdapter } from '../../src/sandbox/deepagents-adapter.js';
import type { SandboxManager } from '../../src/sandbox/manager.js';

describe('buildPriceAnchorAgent', () => {
  it('constructs a ChatDeepSeek model from the given llm config', () => {
    const mockManager = { runExplore: vi.fn(), disposeRun: vi.fn() } as unknown as SandboxManager;
    const backend = new SandboxBackendAdapter(mockManager, 'run-1');

    const agent = buildPriceAnchorAgent({
      llmConfig: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'sk-test' },
      tools: [],
      backend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/agents/price-anchor.test.ts`
Expected: `FAIL` — `Cannot find module '../../src/agents/price-anchor.js'`

- [ ] **Step 3: Implement**

```typescript
// harness/src/agents/price-anchor.ts
// The price-anchor deepagents config: DeepSeek model + market-data tools + Docker sandbox backend,
// per ADR-002/ADR-023/ADR-014 (see spec decisions 1, 2, 4).

import { createDeepAgent } from 'deepagents';
import type { StructuredTool } from '@langchain/core/tools';
import { ChatDeepSeek } from '@langchain/deepseek';
import type { HarnessConfig } from '../config.js';
import type { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';

export interface BuildPriceAnchorAgentParams {
  llmConfig: HarnessConfig['llm'];
  tools: StructuredTool[];
  backend: SandboxBackendAdapter;
}

// Takes the LLM config, MCP tools, and a sandbox backend; returns a configured deepagents instance.
export function buildPriceAnchorAgent({ llmConfig, tools, backend }: BuildPriceAnchorAgentParams) {
  const model = new ChatDeepSeek({ apiKey: llmConfig.api_key, model: llmConfig.model });
  return createDeepAgent({ model, tools, backend });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && pnpm vitest run tests/agents/price-anchor.test.ts`
Expected: `PASS` (1/1)

- [ ] **Step 5: Lint/typecheck**

Run: `cd harness && pnpm lint && pnpm typecheck`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add harness/src/agents/price-anchor.ts harness/tests/agents/price-anchor.test.ts
git commit -m "feat(harness): add price-anchor deepagents config (#9)"
```

---

## Task 4: `single-agent.ts` — the orchestration pipeline

**Files:**
- Create: `harness/src/pipeline/single-agent.ts`
- Test: `harness/tests/e2e/single-agent.test.ts`

**Interfaces:**
- Consumes: `buildPriceAnchorAgent` (Task 3), `SandboxBackendAdapter` (Task 2), `SandboxManager`/`ValidationFailedError`/`SandboxTimeoutError`/`SandboxError` (`harness/src/sandbox/manager.ts`, `types.ts`), `repository.saveForecast`/`saveAgentSignal`/`saveEvalResult` (`harness/src/storage/repository.ts:5,51`), `HarnessConfig` (`harness/src/config.ts`), the real `MultiServerMCPClient` shape confirmed in Task 1 Step 3.
- Produces: `runSingleAgentPipeline(params: { config: HarnessConfig; pool: Pool; symbol: string }): Promise<{ signal: AgentSignal; evalResult: EvalResult }>` — the story's top-level entry point; no downstream task consumes it within this plan (it is #9's deliverable).

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/e2e/single-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSingleAgentPipeline } from '../../src/pipeline/single-agent.js';
import { ValidationFailedError } from '../../src/sandbox/types.js';
import type { HarnessConfig } from '../../src/config.js';
import type { Pool } from 'pg';

vi.mock('langchain-mcp-adapters', () => ({
  MultiServerMCPClient: vi.fn().mockImplementation(() => ({
    getTools: vi.fn().mockResolvedValue([]),
  })),
}));

const mockInvoke = vi.fn();
vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return {
    ...actual,
    createDeepAgent: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  };
});

const mockRunValidate = vi.fn();
const mockDisposeRun = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/sandbox/manager.js', () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({
    runValidate: mockRunValidate,
    runExplore: vi.fn(),
    disposeRun: mockDisposeRun,
  })),
}));

const mockSave = { saveForecast: vi.fn(), saveAgentSignal: vi.fn(), saveEvalResult: vi.fn() };
vi.mock('../../src/storage/repository.js', () => mockSave);

vi.mock('../../src/storage/langfuse.js', () => ({
  getLangfuseClient: vi.fn().mockReturnValue({
    trace: vi.fn().mockReturnValue({ update: vi.fn(), end: vi.fn() }),
  }),
  generateTraceId: vi.fn().mockReturnValue('trace-1'),
}));

const config: HarnessConfig = {
  llm: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'sk-test' },
  mcp_servers: { market: { command: 'node', args: ['server.js'] } },
  capabilities: { chat: 'llm', search: 'llm', sentiment: 'llm', market_data: 'market' },
  storage: { connection_string: 'postgres://x' },
  tracing: { langfuse_public_key: 'pk', langfuse_secret_key: 'sk', langfuse_base_url: 'http://x' },
  sandbox: {},
  eval: {},
};
const pool = {} as Pool;

describe('runSingleAgentPipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: invokes the agent once, validates once, saves all three records', async () => {
    mockInvoke.mockResolvedValue({
      messages: [{ content: JSON.stringify({ direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] }) }],
    });
    mockRunValidate.mockResolvedValue({ evalResult: { verdict: 'pass', layers: [], layer_means: {} } });

    const result = await runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockRunValidate).toHaveBeenCalledTimes(1);
    expect(mockSave.saveForecast).toHaveBeenCalledTimes(1);
    expect(mockSave.saveAgentSignal).toHaveBeenCalledTimes(1);
    expect(mockSave.saveEvalResult).toHaveBeenCalledTimes(1);
    expect(mockDisposeRun).toHaveBeenCalledTimes(1);
    expect(result.evalResult.verdict).toBe('pass');
  });

  it('retries exactly once on ValidationFailedError, then accepts the second result', async () => {
    mockInvoke.mockResolvedValue({
      messages: [{ content: JSON.stringify({ direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] }) }],
    });
    mockRunValidate
      .mockRejectedValueOnce(new ValidationFailedError('bad forecast', 'detail-1'))
      .mockResolvedValueOnce({ evalResult: { verdict: 'pass', layers: [], layer_means: {} } });

    const result = await runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockRunValidate).toHaveBeenCalledTimes(2);
    expect(result.evalResult.verdict).toBe('pass');
  });

  it('propagates SandboxTimeoutError without retrying', async () => {
    const { SandboxTimeoutError } = await import('../../src/sandbox/types.js');
    mockInvoke.mockResolvedValue({
      messages: [{ content: JSON.stringify({ direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] }) }],
    });
    mockRunValidate.mockRejectedValue(new SandboxTimeoutError('timed out'));

    await expect(runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' })).rejects.toThrow('timed out');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockSave.saveForecast).not.toHaveBeenCalled();
  });

  it('rejects a malformed agent response instead of silently proceeding to storage', async () => {
    mockInvoke.mockResolvedValue({ messages: [{ content: 'not json' }] });

    await expect(runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' })).rejects.toThrow();
    expect(mockSave.saveForecast).not.toHaveBeenCalled();
  });

  it('disposes the sandbox even when validation ultimately fails', async () => {
    mockInvoke.mockResolvedValue({
      messages: [{ content: JSON.stringify({ direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] }) }],
    });
    mockRunValidate.mockRejectedValue(new ValidationFailedError('bad', 'detail'));

    await expect(runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' })).rejects.toThrow();
    expect(mockDisposeRun).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && pnpm vitest run tests/e2e/single-agent.test.ts`
Expected: `FAIL` — `Cannot find module '../../src/pipeline/single-agent.js'`

- [ ] **Step 3: Implement**

```typescript
// harness/src/pipeline/single-agent.ts
// Orchestrates the #9 single-agent forecast run: MCP tools -> agent.invoke() -> validate
// (1 retry on failure) -> persist -> Langfuse trace. See spec Data Flow for the full sequence.

import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { buildPriceAnchorAgent } from '../agents/price-anchor.js';
import { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';
import { SandboxManager } from '../sandbox/manager.js';
import { ValidationFailedError } from '../sandbox/types.js';
import type { EvalResult as SandboxEvalResult } from '../sandbox/types.js';
import { saveForecast, saveAgentSignal, saveEvalResult } from '../storage/repository.js';
import { getLangfuseClient, generateTraceId } from '../storage/langfuse.js';
import type { HarnessConfig } from '../config.js';
import type { AgentSignal as AgentSignalRow, EvalResult as EvalResultRow } from '../storage/types.js';

// ADR-023's wire-format signal shape, parsed from the agent's final message content.
interface PriceAnchorSignal {
  direction: 'up' | 'down';
  probability: number;
  confidence: number;
  horizon_days: number;
  evidence: unknown[];
  dissent?: string;
}

export interface RunSingleAgentPipelineParams {
  config: HarnessConfig;
  pool: Pool;
  symbol: string;
}

export interface RunSingleAgentPipelineResult {
  signal: PriceAnchorSignal;
  evalResult: SandboxEvalResult;
}

// Takes the harness config, a Postgres pool, and a symbol; returns the final signal + eval result
// after running, validating, persisting, and tracing one price-anchor forecast.
export async function runSingleAgentPipeline({
  config,
  pool,
  symbol,
}: RunSingleAgentPipelineParams): Promise<RunSingleAgentPipelineResult> {
  const runId = randomUUID();
  const traceId = generateTraceId();
  const asOf = new Date();
  const langfuse = getLangfuseClient(config.tracing);
  const trace = langfuse.trace({ name: 'forecast_run', id: traceId });

  const serverName = config.capabilities.market_data;
  const mcpClient = new MultiServerMCPClient({ [serverName]: config.mcp_servers[serverName] });
  const tools = await mcpClient.getTools();

  const sandboxManager = new SandboxManager();
  const adapter = new SandboxBackendAdapter(sandboxManager, runId);

  try {
    const agent = buildPriceAnchorAgent({ llmConfig: config.llm, tools, backend: adapter });
    const prompt = `Write and execute a Python exponential-smoothing forecast for ${symbol} using the available market data tool, then output only a JSON object matching {direction, probability, confidence, horizon_days, evidence, dissent?}.`;

    let messages = [{ role: 'user' as const, content: prompt }];
    let invokeResult = await agent.invoke({ messages });
    let signal = parseSignal(invokeResult);
    let modelScriptPath = writeModelScript(signal, runId);

    let evalResult: SandboxEvalResult | undefined;
    try {
      const validateResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
      evalResult = validateResult.evalResult;
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        messages = [...messages, { role: 'user' as const, content: err.detail }];
        invokeResult = await agent.invoke({ messages });
        signal = parseSignal(invokeResult);
        modelScriptPath = writeModelScript(signal, runId);
        const retryResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
        evalResult = retryResult.evalResult;
      } else {
        throw err;
      }
    }
    if (!evalResult) throw new Error('validate tier returned no evalResult');

    const forecastRow: AgentSignalRow = { signal, as_of: asOf, forecast_run_id: runId };
    await saveForecast(pool, {
      symbol,
      horizon: `${signal.horizon_days}d`,
      prediction: signal,
      confidence: signal.confidence,
      as_of: asOf,
    });
    await saveAgentSignal(pool, forecastRow);
    await saveEvalResult(pool, evalResult as unknown as EvalResultRow);

    trace.update({ metadata: { symbol, runId } });
    return { signal, evalResult };
  } finally {
    await adapter.dispose();
    trace.end();
  }
}

// Takes the agent's raw invoke() result; returns the parsed ADR-023 signal, throwing on malformed JSON.
function parseSignal(invokeResult: { messages: Array<{ content: unknown }> }): PriceAnchorSignal {
  const last = invokeResult.messages[invokeResult.messages.length - 1];
  const content = typeof last?.content === 'string' ? last.content : '';
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('direction' in parsed) ||
    !('probability' in parsed) ||
    !('confidence' in parsed) ||
    !('horizon_days' in parsed)
  ) {
    throw new Error('agent response does not match AgentSignal shape');
  }
  return parsed as PriceAnchorSignal;
}

// Takes the parsed signal and run id; returns the host path of a written model script for runValidate.
function writeModelScript(signal: PriceAnchorSignal, runId: string): string {
  const path = join(tmpdir(), `model-${runId}.py`);
  writeFileSync(path, `# generated forecast script\nSIGNAL = ${JSON.stringify(signal)}\n`);
  return path;
}
```

Note for whoever implements this task: `writeModelScript` here is a placeholder that writes the *signal*, not the agent's actual generated Python — the real agent output (the code it executed via `execute()`) needs to be captured from the `deepagents` invoke trace, not re-synthesized. This is a genuine open point the test suite above doesn't exercise precisely (it only checks that *some* `modelScriptPath` is passed) — flag it to the validator in Task 4's review, don't treat the placeholder as done.

Also implement `unlinkSync` cleanup of the temp script file in a `finally` around the validate calls if the reviewer confirms it's missing — the code above doesn't clean it up, which is a real resource leak on repeated runs; the validator brief below calls this out explicitly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && pnpm vitest run tests/e2e/single-agent.test.ts`
Expected: `PASS` (5/5)

- [ ] **Step 5: Lint/typecheck**

Run: `cd harness && pnpm lint && pnpm typecheck`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add harness/src/pipeline/single-agent.ts harness/tests/e2e/single-agent.test.ts
git commit -m "feat(harness): add single-agent price-anchor orchestration pipeline (#9)"
```

---

## Gemini Delegation Prompts

Give each task to Gemini one at a time, in order (Task 2 needs Task 1's confirmed package shapes; Task 3 needs Task 2; Task 4 needs Task 3). Paste the full task block (Files/Interfaces/Steps) verbatim as the prompt, plus this preamble:

```
You are implementing one task from docs/superpowers/plans/2026-08-14-price-anchor-e2e-baseline.md
in the Forecasting_Agent repo, harness/ directory (TypeScript, pnpm, vitest). Follow the task's
steps exactly: write the failing test first, run it, confirm it fails for the stated reason,
implement the minimal code to pass, run it again, confirm it passes, run `pnpm lint && pnpm
typecheck`, then commit with the exact message given. Every new file needs a one-line top-of-file
abstract comment and one-line input/output comments on every exported function/class (no
docstrings). Do not modify files outside this task's Files list. Do not push. Report the actual
test output and lint/typecheck output verbatim, not a summary claim.
```

## Validator Brief (run inline after each Gemini task, before moving to the next task)

For every task, independently re-run from a cold state — do not trust Gemini's self-report:
1. `cd harness && pnpm vitest run <task's test file>` — read the actual pass/fail counts.
2. `pnpm lint && pnpm typecheck` — read the actual output, not "no errors reported."
3. `git status` / `git diff` — confirm only the task's declared Files were touched, and check for any unprompted vault writes (a recurring `agy` behavior this session).
4. Task-specific checks:
   - **Task 1:** open the deleted-scratch-file's last known content in the commit history if `tsc` errors surfaced — confirm the *real* `MultiServerMCPClient` shape was recorded, not glossed over.
   - **Task 2:** confirm `execute()`'s output really is `stdout + stderr` concatenation and `truncated` really is an OR of both flags, per the test's exact assertions — a subtly wrong concatenation order is easy to miss by eye.
   - **Task 3:** confirm no MCP client construction leaked into this file — it must only accept `tools` as a parameter, never fetch them itself (a scope violation would silently duplicate Task 4's client).
   - **Task 4:** this is the task most likely to arrive incomplete — explicitly check whether Gemini addressed the two flagged open points (real generated-code capture vs. the signal-only placeholder; temp-file cleanup). If not addressed, that's expected per the plan's own note — do not treat it as a Gemini defect, note it as a known follow-up instead. Confirm the retry-exactly-once behavior with a manual trace read of `mockInvoke`/`mockRunValidate` call counts, not just "the test passed."
