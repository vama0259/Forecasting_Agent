import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AGENT_CONFIGS, ParticipantAgentConfigSchema } from '../src/agents/types.js';
import { dispatchParticipantAgents } from '../src/pipeline/multi-agent.js';
import type { AgentSignal } from '../src/agents/schema.js';
import type { SandboxBackendAdapter } from '../src/sandbox/deepagents-adapter.js';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import type { TraceHandle, getLangchainCallbackHandler } from '../src/tracing/langfuse.js';

const { mockCreateDeepAgent, mockInvoke } = vi.hoisted(() => ({
  mockCreateDeepAgent: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return {
    ...actual,
    createDeepAgent: (opts: unknown) => {
      mockCreateDeepAgent(opts);
      return {
        invoke: (...args: unknown[]) => mockInvoke(opts, ...args),
      };
    },
  };
});

describe('Multi-Agent Roster Configuration', () => {
  it('contains exactly 4 participant agent configurations', () => {
    expect(AGENT_CONFIGS).toHaveLength(4);
  });

  it('contains the expected participant agent names in order', () => {
    const names = AGENT_CONFIGS.map((c) => c.name);
    expect(names).toEqual(['price', 'fii', 'dii', 'retail']);
  });

  it('validates each participant agent configuration with ParticipantAgentConfigSchema', () => {
    for (const config of AGENT_CONFIGS) {
      const parsed = ParticipantAgentConfigSchema.parse(config);
      expect(parsed.name).toBe(config.name);
      expect(parsed.maxTokenBudget).toBe(400_000);
      expect(parsed.horizon_days).toBe(1);
      expect(parsed.generatedBy).toBe('human');
    }
  });

  it('configures price participant correctly', () => {
    const config = AGENT_CONFIGS.find((c) => c.name === 'price');
    expect(config).toBeDefined();
    expect(config).toMatchObject({
      name: 'price',
      roleTitle: 'Price Action & Macro Anchor',
      promptTemplate: 'price.j2',
      allowedCapabilities: ['market_data', 'macro'],
      workspaceSubpath: 'price',
      tools: ['fetch_ohlcv'],
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    });
    expect(config!.allowedWritePaths).toEqual([
      '/workspace/code/features/price/**',
      '/workspace/bars.json',
      '/workspace/model.py',
      '/memories/**',
    ]);
  });

  it('configures fii participant correctly', () => {
    const config = AGENT_CONFIGS.find((c) => c.name === 'fii');
    expect(config).toBeDefined();
    expect(config).toMatchObject({
      name: 'fii',
      roleTitle: 'Foreign Institutional Investor (FII) Intent',
      promptTemplate: 'fii.j2',
      allowedCapabilities: ['market_data', 'flows', 'macro'],
      workspaceSubpath: 'fii',
      tools: ['fetch_flows', 'fetch_ohlcv'],
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    });
    expect(config!.allowedWritePaths).toEqual([
      '/workspace/code/features/fii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ]);
  });

  it('configures dii participant correctly', () => {
    const config = AGENT_CONFIGS.find((c) => c.name === 'dii');
    expect(config).toBeDefined();
    expect(config).toMatchObject({
      name: 'dii',
      roleTitle: 'Domestic Institutional Investor (DII) Intent',
      promptTemplate: 'dii.j2',
      allowedCapabilities: ['market_data', 'flows', 'macro'],
      workspaceSubpath: 'dii',
      tools: ['fetch_flows', 'fetch_ohlcv'],
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    });
    expect(config!.allowedWritePaths).toEqual([
      '/workspace/code/features/dii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ]);
  });

  it('configures retail participant correctly', () => {
    const config = AGENT_CONFIGS.find((c) => c.name === 'retail');
    expect(config).toBeDefined();
    expect(config).toMatchObject({
      name: 'retail',
      roleTitle: 'Retail & Microstructure Intent',
      promptTemplate: 'retail.j2',
      allowedCapabilities: ['market_data', 'microstructure', 'sentiment'],
      workspaceSubpath: 'retail',
      tools: ['fetch_microstructure', 'fetch_option_chain', 'fetch_ohlcv'],
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    });
    expect(config!.allowedWritePaths).toEqual([
      '/workspace/code/features/retail/**',
      '/workspace/microstructure.json',
      '/workspace/option_chain.json',
      '/workspace/bars.json',
      '/memories/**',
    ]);
  });
});

describe('Parallel Dispatch with 4-Agent Roster', () => {
  const mockTrace = {
    traceId: 'mock-trace-id',
    span: vi.fn(),
    update: vi.fn(),
    end: vi.fn(),
    withActive: (fn: () => unknown) => fn(),
    runGrouped: <T>(_opts: unknown, fn: () => Promise<T>) => fn(),
  } as unknown as TraceHandle;

  const mockCallbackHandler = {} as unknown as ReturnType<typeof getLangchainCallbackHandler>;
  const mockSandboxAdapter = {
    downloadFiles: vi.fn().mockResolvedValue([]),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxBackendAdapter;
  const mockStore = {} as BaseStore;
  const llmConfig = {
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    api_key: 'test-key',
    temperature: 0.2,
    max_tokens: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDeepAgent.mockReset();
    mockInvoke.mockReset();
  });

  it('dispatches all 4 agents concurrently and returns 4 validated signals', async () => {
    mockInvoke.mockImplementation(async (_opts: unknown, input: { messages: Array<{ content: string }> }) => {
      const content = input?.messages?.[0]?.content || '';
      let agentName = 'price';
      if (content.includes('Foreign Institutional Investor') || content.includes('fii')) {
        agentName = 'fii';
      } else if (content.includes('Domestic Institutional Investor') || content.includes('dii')) {
        agentName = 'dii';
      } else if (content.includes('Retail & Microstructure') || content.includes('retail')) {
        agentName = 'retail';
      }

      const signal: AgentSignal = {
        agent_name: agentName as 'price' | 'fii' | 'dii' | 'retail',
        direction: 'up',
        probability: 0.65,
        confidence: 0.8,
        horizon_days: 1,
        evidence: [
          {
            claim: `${agentName} thesis valid`,
            source_capability: 'market_data',
            value: 100,
            explicit_absence: false,
          },
        ],
        degraded: false,
      };

      return { structuredResponse: signal };
    });

    const results = await dispatchParticipantAgents({
      symbol: 'TCS.NS',
      asOf: new Date('2026-08-17T00:00:00Z'),
      tools: [],
      sandboxAdapter: mockSandboxAdapter,
      store: mockStore,
      llmConfig,
      trace: mockTrace,
      langfuseHandler: mockCallbackHandler,
    });

    expect(results).toHaveLength(4);

    const names = results.map((r) => r.agentName);
    expect(names).toEqual(['price', 'fii', 'dii', 'retail']);

    for (const res of results) {
      expect(res.degraded).toBe(false);
      expect(res.signal).toBeDefined();
      expect(res.signal?.agent_name).toBe(res.agentName);
      expect(res.signal?.direction).toBe('up');
      expect(res.error).toBeUndefined();
    }
  });

  it('handles partial agent failure gracefully without blocking other agents', async () => {
    mockInvoke.mockImplementation(async (_opts: unknown, input: { messages: Array<{ content: string }> }) => {
      const content = input?.messages?.[0]?.content || '';
      if (content.includes('Retail & Microstructure') || content.includes('retail')) {
        throw new Error('Retail option chain parsing timeout');
      }

      let agentName = 'price';
      if (content.includes('Foreign Institutional Investor') || content.includes('fii')) {
        agentName = 'fii';
      } else if (content.includes('Domestic Institutional Investor') || content.includes('dii')) {
        agentName = 'dii';
      }

      const signal: AgentSignal = {
        agent_name: agentName as 'price' | 'fii' | 'dii',
        direction: 'down',
        probability: 0.55,
        confidence: 0.75,
        horizon_days: 1,
        evidence: [
          {
            claim: `${agentName} thesis signal`,
            source_capability: 'market_data',
            value: 50,
            explicit_absence: false,
          },
        ],
        degraded: false,
      };

      return { structuredResponse: signal };
    });

    const results = await dispatchParticipantAgents({
      symbol: 'TCS.NS',
      asOf: new Date('2026-08-17T00:00:00Z'),
      tools: [],
      sandboxAdapter: mockSandboxAdapter,
      store: mockStore,
      llmConfig,
      trace: mockTrace,
      langfuseHandler: mockCallbackHandler,
    });

    expect(results).toHaveLength(4);

    const successful = results.filter((r) => !r.degraded);
    const failed = results.filter((r) => r.degraded);

    expect(successful).toHaveLength(3);
    expect(successful.map((r) => r.agentName)).toEqual(['price', 'fii', 'dii']);

    expect(failed).toHaveLength(1);
    expect(failed[0]!.agentName).toBe('retail');
    expect(failed[0]!.signal).toBeNull();
    expect(failed[0]!.error).toContain('Retail option chain parsing timeout');
  });

  it('marks degraded when structuredResponse identity does not match configured agent', async () => {
    mockInvoke.mockImplementation(async (_opts: unknown, input: { messages: Array<{ content: string }> }) => {
      const content = input?.messages?.[0]?.content || '';
      // fii agent wrongly outputs retail
      if (content.includes('Foreign Institutional Investor') || content.includes('fii')) {
        return {
          structuredResponse: {
            agent_name: 'retail',
            direction: 'up',
            probability: 0.6,
            confidence: 0.7,
            horizon_days: 1,
            evidence: [
              {
                claim: 'Retail sentiment overflow',
                source_capability: 'market_data',
                value: 100,
                explicit_absence: false,
              },
            ],
            degraded: false,
          },
        };
      }

      let agentName = 'price';
      if (content.includes('Domestic Institutional Investor') || content.includes('dii')) {
        agentName = 'dii';
      } else if (content.includes('Retail & Microstructure') || content.includes('retail')) {
        agentName = 'retail';
      }

      return {
        structuredResponse: {
          agent_name: agentName,
          direction: 'up',
          probability: 0.6,
          confidence: 0.7,
          horizon_days: 1,
          evidence: [
            {
              claim: `${agentName} thesis signal`,
              source_capability: 'market_data',
              value: 100,
              explicit_absence: false,
            },
          ],
          degraded: false,
        },
      };
    });

    const results = await dispatchParticipantAgents({
      symbol: 'TCS.NS',
      asOf: new Date('2026-08-17T00:00:00Z'),
      tools: [],
      sandboxAdapter: mockSandboxAdapter,
      store: mockStore,
      llmConfig,
      trace: mockTrace,
      langfuseHandler: mockCallbackHandler,
    });

    expect(results).toHaveLength(4);

    const fiiResult = results.find((r) => r.agentName === 'fii');
    expect(fiiResult).toBeDefined();
    expect(fiiResult!.degraded).toBe(true);
    expect(fiiResult!.signal).toBeNull();
    expect(fiiResult!.error).toContain(
      "Agent identity mismatch: configured agent is 'fii', but structured response returned 'retail'",
    );
  });
});
