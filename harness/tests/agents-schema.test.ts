import { describe, it, expect } from 'vitest';
import { AgentSignalSchema, EvidenceItemSchema } from '../src/agents/schema.js';
import { AGENT_CONFIGS, ParticipantAgentConfigSchema } from '../src/agents/types.js';

describe('EvidenceItemSchema', () => {
  it('validates a valid evidence item', () => {
    const validItem = {
      claim: 'RSI oversold',
      source_capability: 'market_data',
      value: 28.5,
      explicit_absence: false,
    };
    const parsed = EvidenceItemSchema.parse(validItem);
    expect(parsed.claim).toBe('RSI oversold');
    expect(parsed.source_capability).toBe('market_data');
    expect(parsed.explicit_absence).toBe(false);
  });

  it('rejects empty claim or missing source_capability', () => {
    expect(() =>
      EvidenceItemSchema.parse({
        claim: '',
        source_capability: 'market_data',
      }),
    ).toThrow();

    expect(() =>
      EvidenceItemSchema.parse({
        claim: 'Valid claim',
        source_capability: '',
      }),
    ).toThrow();
  });
});

describe('AgentSignalSchema', () => {
  it('validates a correct AgentSignal', () => {
    const validSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 1,
      evidence: [
        {
          claim: 'RSI is oversold at 28.5',
          source_capability: 'market_data',
          value: 28.5,
          explicit_absence: false,
        },
      ],
      degraded: false,
    };
    const parsed = AgentSignalSchema.parse(validSignal);
    expect(parsed.agent_name).toBe('price');
    expect(parsed.direction).toBe('up');
  });

  it('rejects invalid agent_name outside ADR-023 set', () => {
    const invalidSignal = {
      agent_name: 'unknown_agent',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 1,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: 1, explicit_absence: false }],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });

  it('rejects horizon_days != 1', () => {
    const invalidSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 5,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: 1, explicit_absence: false }],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });

  it('rejects empty evidence array', () => {
    const invalidSignal = {
      agent_name: 'price',
      direction: 'down',
      probability: 0.7,
      confidence: 0.5,
      horizon_days: 1,
      evidence: [],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });

  it('rejects probability < 0.50 for chosen direction', () => {
    const invalidSignal = {
      agent_name: 'price',
      direction: 'down',
      probability: 0.38,
      confidence: 0.8,
      horizon_days: 1,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: 1, explicit_absence: false }],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow(/Probability for chosen direction must be >= 0\.50/);
  });
});

describe('AGENT_CONFIGS', () => {
  it('contains the valid price agent configuration', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price');
    expect(priceConfig).toBeDefined();
    const parsed = ParticipantAgentConfigSchema.parse(priceConfig);
    expect(parsed.workspaceSubpath).toBe('price');
    expect(parsed.tools).toContain('fetch_ohlcv');
  });
});
