// harness/tests/e2e/single-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSingleAgentPipeline } from '../../src/pipeline/single-agent.js';
import { ValidationFailedError } from '../../src/sandbox/types.js';
import type { HarnessConfig } from '../../src/config.js';
import type { Pool } from 'pg';

const { mockInvoke, mockRunValidate, mockDisposeRun, mockSave } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRunValidate: vi.fn(),
  mockDisposeRun: vi.fn().mockResolvedValue(undefined),
  mockSave: {
    saveForecast: vi.fn(),
    saveAgentSignal: vi.fn(),
    saveEvalResult: vi.fn(),
  },
}));

vi.mock('langchain-mcp-adapters', () => ({
  MultiServerMCPClient: class {
    getTools() {
      return Promise.resolve([]);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return {
    ...actual,
    createDeepAgent: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  };
});

vi.mock('../../src/sandbox/manager.js', () => ({
  SandboxManager: class {
    runValidate = mockRunValidate;
    // Default: no /workspace/model.py in the (mocked, empty) sandbox -- writeModelScript's
    // downloadFiles() call falls back to its placeholder script, same as before this file
    // existed to read from.
    runExplore = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 1,
      durationMs: 1,
    });
    disposeRun = mockDisposeRun;
  },
}));

vi.mock('../../src/storage/repository.js', () => mockSave);

vi.mock('../../src/tracing/langfuse.js', () => ({
  flushTraces: vi.fn().mockResolvedValue(undefined),
  getLangchainCallbackHandler: vi.fn().mockReturnValue({}),
  startForecastTrace: vi.fn().mockReturnValue({
    traceId: 'trace-1',
    update: vi.fn(),
    end: vi.fn(),
    span: vi.fn(),
    withActive: vi.fn((fn: () => unknown) => fn()),
    runGrouped: vi.fn((_attributes: unknown, fn: () => unknown) => fn()),
  }),
}));

vi.mock('../../src/tracing/correlation.js', () => ({
  generateTraceId: vi.fn().mockReturnValue('trace-1'),
}));

const config: HarnessConfig = {
  llm: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'sk-test' },
  mcp_servers: { market: { command: 'node', args: ['server.js'], env: {} } },
  capabilities: { chat: 'llm', search: 'llm', sentiment: 'llm', market_data: 'market' },
  storage: { connection_string: 'postgres://x' },
  tracing: { langfuse_public_key: 'pk', langfuse_secret_key: 'sk', langfuse_base_url: 'http://x' },
  redis: { url: 'redis://127.0.0.1:6379' },
  search: {
    initial_run_budget: 20,
    daily_cap: 2000,
    run_ttl_seconds: 21600,
    provider_timeout_ms: 15000,
    max_results: 10,
    allowed_domains: ['moneycontrol.com'],
  },
  sandbox: {},
  eval: {},
};
const pool = {} as Pool;

describe('runSingleAgentPipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: invokes the agent once, validates once, saves all three records', async () => {
    mockInvoke.mockResolvedValue({
      messages: [
        {
          content: JSON.stringify({
            direction: 'up',
            probability: 0.6,
            confidence: 0.7,
            horizon_days: 5,
            evidence: [],
          }),
        },
      ],
      structuredResponse: { direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] },
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
      messages: [
        {
          content: JSON.stringify({
            direction: 'up',
            probability: 0.6,
            confidence: 0.7,
            horizon_days: 5,
            evidence: [],
          }),
        },
      ],
      structuredResponse: { direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] },
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
      messages: [
        {
          content: JSON.stringify({
            direction: 'up',
            probability: 0.6,
            confidence: 0.7,
            horizon_days: 5,
            evidence: [],
          }),
        },
      ],
      structuredResponse: { direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] },
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
      messages: [
        {
          content: JSON.stringify({
            direction: 'up',
            probability: 0.6,
            confidence: 0.7,
            horizon_days: 5,
            evidence: [],
          }),
        },
      ],
      structuredResponse: { direction: 'up', probability: 0.6, confidence: 0.7, horizon_days: 5, evidence: [] },
    });
    mockRunValidate.mockRejectedValue(new ValidationFailedError('bad', 'detail'));

    await expect(runSingleAgentPipeline({ config, pool, symbol: 'RELIANCE.NS' })).rejects.toThrow();
    expect(mockDisposeRun).toHaveBeenCalledTimes(1);
  });
});
