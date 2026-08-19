// Tests for single-agent pipeline search wiring verifying lifecycle, tool attachment, and metadata.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { runSingleAgentPipeline } from '../../src/pipeline/single-agent.js';
import type { HarnessConfig } from '../../src/config.js';
import type { SearchCapability, SearchOutcome, SearchRunLifecycle } from '../../src/search/types.js';

const { mockInvoke, mockRunValidate, mockDisposeRun, mockSave, mockCreateDeepAgent, mockTraceUpdate } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn(),
    mockRunValidate: vi.fn(),
    mockDisposeRun: vi.fn().mockResolvedValue(undefined),
    mockSave: {
      saveForecast: vi.fn(),
      saveAgentSignal: vi.fn(),
      saveEvalResults: vi.fn(),
      saveSearchObservations: vi.fn(),
    },
    mockCreateDeepAgent: vi.fn(),
    mockTraceUpdate: vi.fn(),
  }),
);

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
    createDeepAgent: (...args: unknown[]) => {
      mockCreateDeepAgent(...args);
      return { invoke: mockInvoke };
    },
  };
});

vi.mock('../../src/sandbox/manager.js', () => ({
  SandboxManager: class {
    runValidate = mockRunValidate;
    runExplore = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
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
    traceId: 'mock-trace-id',
    runGrouped: (_opts: unknown, fn: () => unknown) => fn(),
    withActive: (fn: () => unknown) => fn(),
    update: mockTraceUpdate,
    end: vi.fn(),
  }),
}));

describe('Pipeline search wiring', () => {
  const mockConfig = {
    llm: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      api_key: 'test',
      temperature: 0.2,
      max_tokens: 1000,
    },
    mcp_servers: {
      market: {
        command: 'echo',
        args: ['market'],
      },
    },
    capabilities: {
      chat: 'deepseek',
      market_data: 'market',
      search: 'anysearch',
      sentiment: 'market',
    },
    redis: {
      url: 'redis://127.0.0.1:6379',
    },
    search: {
      daily_quota_cap: 2000,
      initial_run_budget: 20,
      run_ttl_seconds: 600,
      provider_timeout_ms: 10000,
      max_results: 10,
      allowed_domains: ['moneycontrol.com'],
    },
    tracing: {
      langfuse_enabled: false,
    },
    storage: {
      connection_string: 'postgresql://harness:harness@127.0.0.1:5432/harness',
    },
    sandbox: {
      warm_pool_size: 1,
      idle_timeout_seconds: 60,
      max_active_containers: 2,
    },
  } as unknown as HarnessConfig;

  const mockPool = {} as unknown as Pool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDeepAgent.mockReset();
    mockInvoke.mockReset();
    mockRunValidate.mockReset();
    mockTraceUpdate.mockReset();

    mockCreateDeepAgent.mockImplementation(() => ({ invoke: mockInvoke }));
    mockInvoke.mockResolvedValue({
      structuredResponse: {
        direction: 'up',
        probability: 0.75,
        confidence: 0.8,
        horizon_days: 5,
        evidence: ['Strong earnings'],
      },
    });
    mockRunValidate.mockResolvedValue({
      evalResult: { verdict: 'PASS', metrics: { brier_score: 0.1 } },
    });
  });

  it('claims search budget, attaches search_news tool, and releases budget on success', async () => {
    let capturedSearchTool: unknown;
    mockCreateDeepAgent.mockImplementation((opts: { tools: unknown[] }) => {
      capturedSearchTool = opts.tools.find((t: unknown) => (t as { name: string }).name === 'search_news');
      return { invoke: mockInvoke };
    });

    const searchMock: SearchCapability & SearchRunLifecycle = {
      beginRun: vi.fn().mockResolvedValue(20),
      endRun: vi.fn().mockResolvedValue(15),
      search: vi.fn().mockResolvedValue({
        results: [],
        source: 'provider',
        degraded: false,
      } as SearchOutcome),
    };

    const result = await runSingleAgentPipeline({
      config: mockConfig,
      pool: mockPool,
      symbol: 'RELIANCE.NS',
      search: searchMock,
    });

    expect(result.signal.direction).toBe('up');
    expect(searchMock.beginRun).toHaveBeenCalledTimes(1);
    expect(searchMock.endRun).toHaveBeenCalledTimes(1);
    expect(capturedSearchTool).toBeDefined();
    expect((capturedSearchTool as { name: string }).name).toBe('search_news');

    expect(mockTraceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          search_granted: 20,
          search_spent: 5,
          search_degraded: false,
        }),
      }),
    );
    expect(mockSave.saveForecast).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        degraded: false,
      }),
    );
  });

  it('records degraded flag when search tool encounters degradation', async () => {
    mockCreateDeepAgent.mockImplementation((opts: { tools: unknown[] }) => {
      const tool = opts.tools.find((t: unknown) => (t as { name: string }).name === 'search_news') as {
        invoke: (arg: { query: string }) => Promise<string>;
      };
      if (tool) {
        // Model invokes search tool which returns degraded outcome
        mockInvoke.mockImplementation(async () => {
          await tool.invoke({ query: 'some news query' });
          return {
            structuredResponse: {
              direction: 'down',
              probability: 0.6,
              confidence: 0.5,
              horizon_days: 5,
              evidence: ['Degraded news'],
            },
          };
        });
      }
      return { invoke: mockInvoke };
    });

    const searchMock: SearchCapability & SearchRunLifecycle = {
      beginRun: vi.fn().mockResolvedValue(20),
      endRun: vi.fn().mockResolvedValue(19),
      search: vi.fn().mockResolvedValue({
        results: [],
        source: 'degraded',
        degraded: true,
      } as SearchOutcome),
    };

    await runSingleAgentPipeline({
      config: mockConfig,
      pool: mockPool,
      symbol: 'RELIANCE.NS',
      search: searchMock,
    });

    expect(mockSave.saveForecast).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        degraded: true,
      }),
    );
    expect(mockTraceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          search_granted: 20,
          search_spent: 1,
          search_degraded: true,
        }),
      }),
    );
  });

  it('releases search budget in finally even when agent invocation throws', async () => {
    mockInvoke.mockRejectedValue(new Error('LLM rate limit reached'));

    const searchMock: SearchCapability & SearchRunLifecycle = {
      beginRun: vi.fn().mockResolvedValue(20),
      endRun: vi.fn().mockResolvedValue(20),
      search: vi.fn(),
    };

    await expect(
      runSingleAgentPipeline({
        config: mockConfig,
        pool: mockPool,
        symbol: 'RELIANCE.NS',
        search: searchMock,
      }),
    ).rejects.toThrow('LLM rate limit reached');

    expect(searchMock.beginRun).toHaveBeenCalledTimes(1);
    expect(searchMock.endRun).toHaveBeenCalledTimes(1);
    expect(mockTraceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          search_granted: 20,
          search_spent: 0,
        }),
      }),
    );
  });
});
