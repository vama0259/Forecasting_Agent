import { describe, it, expect } from 'vitest';
import { CapabilitySchema, EvidenceItemSchema } from '../src/agents/schema.js';
import { ParticipantAgentConfigSchema } from '../src/agents/types.js';

describe('Capability and Schema Strictness', () => {
  it('validates CapabilitySchema allowed literals and rejects unknown capabilities', () => {
    expect(CapabilitySchema.parse('market_data')).toBe('market_data');
    expect(CapabilitySchema.parse('flows')).toBe('flows');
    expect(CapabilitySchema.parse('microstructure')).toBe('microstructure');
    expect(CapabilitySchema.parse('sentiment')).toBe('sentiment');
    expect(CapabilitySchema.parse('macro')).toBe('macro');
    expect(() => CapabilitySchema.parse('unapproved_cap')).toThrow();
  });

  it('enforces CapabilitySchema on EvidenceItemSchema', () => {
    const valid = {
      claim: 'FII long index ratio expanded to 1.4',
      source_capability: 'flows',
      value: 1.4,
      explicit_absence: false,
    };
    expect(EvidenceItemSchema.parse(valid)).toEqual(valid);

    const invalid = {
      claim: 'Some claim',
      source_capability: 'invalid_cap',
      value: 1.0,
    };
    expect(() => EvidenceItemSchema.parse(invalid)).toThrow();
  });

  it('enforces CapabilitySchema on ParticipantAgentConfigSchema', () => {
    const valid = {
      name: 'price',
      roleTitle: 'Price Action & Macro Anchor',
      description: 'Analyzes target OHLCV, momentum indicators, moving averages, and sovereign macro drivers.',
      promptTemplate: 'price.j2',
      allowedCapabilities: ['market_data', 'macro'],
      dataLaneDescription: 'OHLCV bars + technical indicators + macro drivers',
      workspaceSubpath: 'price',
      allowedWritePaths: ['/workspace/bars.json'],
      tools: ['fetch_ohlcv'],
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    };
    expect(ParticipantAgentConfigSchema.parse(valid)).toEqual(valid);

    const invalid = {
      ...valid,
      allowedCapabilities: ['market_data', 'invalid_capability'],
    };
    expect(() => ParticipantAgentConfigSchema.parse(invalid)).toThrow();
  });
});
