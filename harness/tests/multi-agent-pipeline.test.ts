import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { dispatchParticipantAgents, runMultiAgentPipeline } from '../src/pipeline/multi-agent.js';
import type { HarnessConfig } from '../src/config.js';
import type { SearchCapability, SearchOutcome, SearchRunLifecycle } from '../src/search/types.js';
import type { AgentSignal } from '../src/agents/schema.js';
import type { SandboxBackendAdapter } from '../src/sandbox/deepagents-adapter.js';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import type { TraceHandle, getLangchainCallbackHandler } from '../src/tracing/langfuse.js';

const {
  mockInvoke,
  mockRunValidate,
  mockDisposeRun,
  mockSaveForecast,
  mockSaveAgentSignal,
  mockSaveEvalResult,
  mockCreateDeepAgent,
  mockTraceUpdate,
  mockTraceEnd,
  mockFlushTraces,
  mockDownloadFiles,
  mockAdapterDispose,
  mockMcpClose,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRunValidate: vi.fn(),
  mockDisposeRun: vi.fn().mockResolvedValue(undefined),
  mockSaveForecast: vi.fn().mockResolvedValue(undefined),
  mockSaveAgentSignal: vi.fn().mockResolvedValue(undefined),
  mockSaveEvalResult: vi.fn().mockResolvedValue(undefined),
  mockCreateDeepAgent: vi.fn(),
  mockTraceUpdate: vi.fn(),
  mockTraceEnd: vi.fn(),
  mockFlushTraces: vi.fn().mockResolvedValue(undefined),
  mockDownloadFiles: vi.fn().mockResolvedValue([]),
  mockAdapterDispose: vi.fn().mockResolvedValue(undefined),
  mockMcpClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('langchain-mcp-adapters', () => ({
  MultiServerMCPClient: class {
    getTools() {
      return Promise.resolve([{ name: 'fetch_ohlcv', invoke: vi.fn() }]);
    }
    close = mockMcpClose;
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

vi.mock('../src/sandbox/manager.js', () => ({
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

vi.mock('../src/sandbox/deepagents-adapter.js', () => ({
  SandboxBackendAdapter: class {
    downloadFiles = mockDownloadFiles;
    dispose = mockAdapterDispose;
  },
}));

vi.mock('../src/storage/repository.js', () => ({
  saveForecast: mockSaveForecast,
  saveAgentSignal: mockSaveAgentSignal,
  saveEvalResult: mockSaveEvalResult,
}));

vi.mock('../src/tracing/langfuse.js', () => ({
  flushTraces: mockFlushTraces,
  getLangchainCallbackHandler: vi.fn().mockReturnValue({}),
  startForecastTrace: vi.fn().mockReturnValue({
    traceId: 'mock-trace-id',
    runGrouped: (_opts: unknown, fn: () => unknown) => fn(),
    withActive: (fn: () => unknown) => fn(),
    update: mockTraceUpdate,
    end: mockTraceEnd,
  }),
}));

describe('multi-agent pipeline', () => {
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

  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;

  const mockTrace = {
    traceId: 'mock-trace-id',
    span: vi.fn(),
    update: mockTraceUpdate,
    end: mockTraceEnd,
    withActive: (fn: () => unknown) => fn(),
    runGrouped: <T>(_opts: unknown, fn: () => Promise<T>) => fn(),
  } as unknown as TraceHandle;

  const mockCallbackHandler = {} as unknown as ReturnType<typeof getLangchainCallbackHandler>;

  const validPriceSignal: AgentSignal = {
    agent_name: 'price',
    direction: 'up',
    probability: 0.7,
    confidence: 0.8,
    horizon_days: 1,
    evidence: [
      {
        claim: '200 EMA breakout',
        source_capability: 'market_data',
        value: 2500,
        explicit_absence: false,
      },
    ],
    degraded: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDeepAgent.mockReset();
    mockInvoke.mockReset();
    mockRunValidate.mockReset();
    mockTraceUpdate.mockReset();
    mockTraceEnd.mockReset();
    mockFlushTraces.mockReset();
    mockDownloadFiles.mockReset();
    mockAdapterDispose.mockReset();
    mockMcpClose.mockReset();

    mockCreateDeepAgent.mockImplementation(() => ({ invoke: mockInvoke }));
    mockInvoke.mockResolvedValue({
      structuredResponse: validPriceSignal,
    });
    mockRunValidate.mockResolvedValue({
      evalResult: { verdict: 'PASS', layers: [], layer_means: {} },
    });
    mockDownloadFiles.mockResolvedValue([{ path: '/workspace/model.py', content: Buffer.from('print("model")') }]);
  });

  describe('exports', () => {
    it('exports runMultiAgentPipeline function', () => {
      expect(typeof runMultiAgentPipeline).toBe('function');
    });

    it('exports dispatchParticipantAgents function', () => {
      expect(typeof dispatchParticipantAgents).toBe('function');
    });
  });

  describe('dispatchParticipantAgents', () => {
    it('dispatches configured participant agents and returns structured signals', async () => {
      const mockSandboxAdapter = {
        downloadFiles: mockDownloadFiles,
        dispose: vi.fn(),
      } as unknown as SandboxBackendAdapter;
      const mockStore = {} as BaseStore;

      const results = await dispatchParticipantAgents({
        symbol: 'TCS.NS',
        asOf: new Date('2026-08-17T00:00:00Z'),
        tools: [],
        sandboxAdapter: mockSandboxAdapter,
        store: mockStore,
        llmConfig: mockConfig.llm,
        trace: mockTrace,
        langfuseHandler: mockCallbackHandler,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        agentName: 'price',
        signal: validPriceSignal,
        degraded: false,
      });
    });

    it('handles agent execution failure gracefully with degraded status and error message', async () => {
      mockInvoke.mockRejectedValue(new Error('LLM call failed with rate limit'));

      const mockSandboxAdapter = {} as unknown as SandboxBackendAdapter;
      const mockStore = {} as BaseStore;

      const results = await dispatchParticipantAgents({
        symbol: 'TCS.NS',
        asOf: new Date('2026-08-17T00:00:00Z'),
        tools: [],
        sandboxAdapter: mockSandboxAdapter,
        store: mockStore,
        llmConfig: mockConfig.llm,
        trace: mockTrace,
        langfuseHandler: mockCallbackHandler,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        agentName: 'price',
        signal: null,
        degraded: true,
        error: 'LLM call failed with rate limit',
      });
    });

    it('throws error and marks degraded when agent identity mismatches configured agent name', async () => {
      mockInvoke.mockResolvedValue({
        structuredResponse: {
          ...validPriceSignal,
          agent_name: 'fii', // mismatched identity
        },
      });

      const mockSandboxAdapter = {} as unknown as SandboxBackendAdapter;
      const mockStore = {} as BaseStore;

      const results = await dispatchParticipantAgents({
        symbol: 'TCS.NS',
        asOf: new Date('2026-08-17T00:00:00Z'),
        tools: [],
        sandboxAdapter: mockSandboxAdapter,
        store: mockStore,
        llmConfig: mockConfig.llm,
        trace: mockTrace,
        langfuseHandler: mockCallbackHandler,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.degraded).toBe(true);
      expect(results[0]!.signal).toBeNull();
      expect(results[0]!.error).toContain(
        "Agent identity mismatch: configured agent is 'price', but structured response returned 'fii'",
      );
    });
  });

  describe('runMultiAgentPipeline', () => {
    it('executes full pipeline, validates anchor model script, persists records, and updates trace', async () => {
      const mockStore = {} as BaseStore;
      const searchMock: SearchCapability & SearchRunLifecycle = {
        beginRun: vi.fn().mockResolvedValue(20),
        endRun: vi.fn().mockResolvedValue(15),
        search: vi.fn().mockResolvedValue({
          results: [],
          source: 'provider',
          degraded: false,
        } as SearchOutcome),
      };

      const result = await runMultiAgentPipeline({
        config: mockConfig,
        pool: mockPool,
        symbol: 'RELIANCE.NS',
        search: searchMock,
        store: mockStore,
      });

      expect(result.signals.price).toEqual(validPriceSignal);
      expect(result.degradedAgents).toEqual([]);
      expect(result.evalResult.verdict).toBe('PASS');

      // Check persistence
      expect(mockSaveForecast).toHaveBeenCalledTimes(1);
      expect(mockSaveForecast).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          symbol: 'RELIANCE.NS',
          horizon: '1d',
          prediction: validPriceSignal,
          confidence: 0.8,
          degraded: false,
        }),
      );

      expect(mockSaveAgentSignal).toHaveBeenCalledTimes(1);
      expect(mockSaveAgentSignal).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          signal: validPriceSignal,
        }),
      );

      expect(mockSaveEvalResult).toHaveBeenCalledTimes(1);

      // Check search lifecycle
      expect(searchMock.beginRun).toHaveBeenCalledTimes(1);
      expect(searchMock.endRun).toHaveBeenCalledTimes(1);

      // Check cleanup
      expect(mockAdapterDispose).toHaveBeenCalledTimes(1);
      expect(mockMcpClose).toHaveBeenCalledTimes(1);

      // Check tracing
      expect(mockTraceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            symbol: 'RELIANCE.NS',
            degradedAgents: [],
          }),
          output: expect.objectContaining({
            signals: expect.objectContaining({ price: validPriceSignal }),
            verdict: 'PASS',
          }),
        }),
      );
      expect(mockTraceEnd).toHaveBeenCalledTimes(1);
      expect(mockFlushTraces).toHaveBeenCalledTimes(1);
    });

    it('marks forecast as degraded when anchor agent signal is degraded', async () => {
      const degradedSignal: AgentSignal = {
        ...validPriceSignal,
        degraded: true,
      };
      mockInvoke.mockResolvedValue({
        structuredResponse: degradedSignal,
      });

      const result = await runMultiAgentPipeline({
        config: mockConfig,
        pool: mockPool,
        symbol: 'RELIANCE.NS',
      });

      expect(result.degradedAgents).toContain('price');
      expect(mockSaveForecast).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          degraded: true,
        }),
      );
    });

    it('throws error when anchor agent fails to produce a valid signal', async () => {
      mockInvoke.mockRejectedValue(new Error('Anchor agent timeout'));

      await expect(
        runMultiAgentPipeline({
          config: mockConfig,
          pool: mockPool,
          symbol: 'RELIANCE.NS',
        }),
      ).rejects.toThrow("Anchor agent 'price' failed to produce a valid signal");

      expect(mockAdapterDispose).toHaveBeenCalledTimes(1);
      expect(mockMcpClose).toHaveBeenCalledTimes(1);
      expect(mockTraceEnd).toHaveBeenCalledTimes(1);
      expect(mockFlushTraces).toHaveBeenCalledTimes(1);
    });

    it('throws error when market_data MCP server config is missing', async () => {
      const badConfig = {
        ...mockConfig,
        mcp_servers: {},
      } as unknown as HarnessConfig;

      await expect(
        runMultiAgentPipeline({
          config: badConfig,
          pool: mockPool,
          symbol: 'RELIANCE.NS',
        }),
      ).rejects.toThrow("MCP server configuration missing for capability 'market_data' (market)");
    });
  });
});
