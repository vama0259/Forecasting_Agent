import { describe, it, expect } from 'vitest';
import type { AgentSignal } from '../src/agents/schema.js';
import type { ParticipantAgentConfig } from '../src/agents/types.js';
import type { ParticipantExecutionResult } from '../src/pipeline/multi-agent.js';

async function dispatchParticipantAgentsWithMock(
  configs: ParticipantAgentConfig[],
  mockInvoke: (config: ParticipantAgentConfig) => Promise<AgentSignal>,
): Promise<ParticipantExecutionResult[]> {
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const signal = await mockInvoke(config);
      if (signal.agent_name !== config.name) {
        throw new Error(
          `Agent identity mismatch: configured agent is '${config.name}', but structured response returned '${signal.agent_name}'`,
        );
      }
      return {
        agentName: config.name,
        signal,
        degraded: signal.degraded || false,
      };
    }),
  );

  return results.map((res, i) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    const config = configs[i];
    return {
      agentName: config ? config.name : 'unknown',
      signal: null,
      degraded: true,
      error: res.reason instanceof Error ? res.reason.message : String(res.reason),
    };
  });
}

describe('Comprehension Gate: Dynamic Responsiveness & Identity Integrity', () => {
  const testConfig: ParticipantAgentConfig = {
    name: 'price',
    roleTitle: 'Price Action & Macro Anchor',
    description: 'Analyzes target OHLCV and macro drivers.',
    promptTemplate: 'price.j2',
    allowedCapabilities: ['market_data', 'macro'],
    dataLaneDescription: 'OHLCV bars + technical indicators',
    workspaceSubpath: 'price',
    allowedWritePaths: [
      '/workspace/code/features/price/**',
      '/workspace/bars.json',
      '/workspace/model.py',
      '/memories/**',
    ],
    tools: ['fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 200_000,
    horizon_days: 1,
    generatedBy: 'human',
  };

  it('dynamically responds to varying signal directions, probabilities, and evidence claims', async () => {
    const signalA: AgentSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.85,
      confidence: 0.9,
      horizon_days: 1,
      evidence: [
        { claim: 'Breakout above 200 EMA', source_capability: 'market_data', value: 3450, explicit_absence: false },
      ],
      degraded: false,
    };

    const signalB: AgentSignal = {
      agent_name: 'price',
      direction: 'down',
      probability: 0.25,
      confidence: 0.4,
      horizon_days: 1,
      evidence: [
        { claim: 'Bearish divergence on RSI', source_capability: 'market_data', value: 72, explicit_absence: false },
      ],
      degraded: false,
    };

    const resultsA = await dispatchParticipantAgentsWithMock([testConfig], async () => signalA);
    const resultsB = await dispatchParticipantAgentsWithMock([testConfig], async () => signalB);

    const firstA = resultsA[0];
    const firstB = resultsB[0];

    expect(firstA).toBeDefined();
    expect(firstB).toBeDefined();
    if (!firstA || !firstB) throw new Error('Unchecked indexing assertion');

    expect(firstA.signal?.direction).toBe('up');
    expect(firstA.signal?.probability).toBe(0.85);
    expect(firstA.signal?.evidence[0]?.claim).toBe('Breakout above 200 EMA');

    expect(firstB.signal?.direction).toBe('down');
    expect(firstB.signal?.probability).toBe(0.25);
    expect(firstB.signal?.evidence[0]?.claim).toBe('Bearish divergence on RSI');
  });

  it('rejects agent identity mismatches when model returns a different agent_name than configured', async () => {
    const mismatchSignal: AgentSignal = {
      agent_name: 'fii', // Configured as 'price'
      direction: 'up',
      probability: 0.5,
      confidence: 0.5,
      horizon_days: 1,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: null, explicit_absence: false }],
      degraded: false,
    };

    const results = await dispatchParticipantAgentsWithMock([testConfig], async () => mismatchSignal);
    const firstResult = results[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) throw new Error('Unchecked indexing assertion');

    expect(firstResult.signal).toBeNull();
    expect(firstResult.degraded).toBe(true);
    expect(firstResult.error).toContain('Agent identity mismatch');
  });
});
