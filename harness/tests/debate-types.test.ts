import { describe, it, expect } from 'vitest';
import {
  AgentCritiqueItemSchema,
  Round2SignalSchema,
  Round3SignalSchema,
  ScenarioDetailSchema,
  ScenarioSynthesisSchema,
  ParticipantWeightsSchema,
  SignalsByRoundSchema,
  DebateConsensusSchema,
} from '../src/debate/types.js';

describe('Debate Types and Wire Schemas', () => {
  const baseEvidence = [
    {
      claim: 'Price 20 EMA crossover',
      source_capability: 'market_data' as const,
      value: 123.45,
      explicit_absence: false,
    },
  ];

  const validBaseSignal = {
    agent_name: 'price' as const,
    direction: 'up' as const,
    probability: 0.75,
    confidence: 0.8,
    horizon_days: 1 as const,
    evidence: baseEvidence,
    degraded: false,
  };

  describe('AgentCritiqueItemSchema', () => {
    it('validates a valid critique item with counter_evidence_capability', () => {
      const critique = {
        target_agent: 'fii',
        agreement_level: 'disagree',
        critique_point: 'FII selling is concentrated in index futures, not cash equity',
        counter_evidence_capability: 'flows',
      };
      const parsed = AgentCritiqueItemSchema.parse(critique);
      expect(parsed.target_agent).toBe('fii');
      expect(parsed.agreement_level).toBe('disagree');
      expect(parsed.counter_evidence_capability).toBe('flows');
    });

    it('validates a valid critique item without counter_evidence_capability', () => {
      const critique = {
        target_agent: 'dii',
        agreement_level: 'agree',
        critique_point: 'DII buying matches historical support levels',
      };
      const parsed = AgentCritiqueItemSchema.parse(critique);
      expect(parsed.counter_evidence_capability).toBeUndefined();
    });

    it('rejects invalid target_agent or agreement_level', () => {
      expect(() =>
        AgentCritiqueItemSchema.parse({
          target_agent: 'macro_agent',
          agreement_level: 'agree',
          critique_point: 'Invalid target agent',
        }),
      ).toThrow();

      expect(() =>
        AgentCritiqueItemSchema.parse({
          target_agent: 'price',
          agreement_level: 'neutral',
          critique_point: 'Invalid agreement level',
        }),
      ).toThrow();
    });

    it('rejects empty critique_point', () => {
      expect(() =>
        AgentCritiqueItemSchema.parse({
          target_agent: 'price',
          agreement_level: 'disagree',
          critique_point: '',
        }),
      ).toThrow();
    });

    it('rejects extra keys (.strict())', () => {
      expect(() =>
        AgentCritiqueItemSchema.parse({
          target_agent: 'price',
          agreement_level: 'agree',
          critique_point: 'Valid point',
          extra_field: 123,
        }),
      ).toThrow();
    });
  });

  describe('Round2SignalSchema', () => {
    const validRound2 = {
      ...validBaseSignal,
      round: 2 as const,
      critiques: [
        {
          target_agent: 'fii' as const,
          agreement_level: 'disagree' as const,
          critique_point: 'FII flows are lagging indicator here',
        },
      ],
      probability_delta: 0.05,
    };

    it('validates a valid Round 2 signal', () => {
      const parsed = Round2SignalSchema.parse(validRound2);
      expect(parsed.round).toBe(2);
      expect(parsed.probability_delta).toBe(0.05);
      expect(parsed.critiques).toHaveLength(1);
    });

    it('rejects round != 2', () => {
      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          round: 1,
        }),
      ).toThrow();

      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          round: 3,
        }),
      ).toThrow();
    });

    it('rejects empty critiques array', () => {
      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          critiques: [],
        }),
      ).toThrow();
    });

    it('rejects probability_delta out of [-1, 1] range', () => {
      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          probability_delta: 1.5,
        }),
      ).toThrow();

      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          probability_delta: -1.2,
        }),
      ).toThrow();
    });

    it('rejects extra fields (.strict())', () => {
      expect(() =>
        Round2SignalSchema.parse({
          ...validRound2,
          unexpected_extra: 'boom',
        }),
      ).toThrow();
    });
  });

  describe('Round3SignalSchema', () => {
    const validRound3 = {
      ...validBaseSignal,
      round: 3 as const,
      is_devils_advocate: true,
      catastrophic_risks: ['RBI surprise rate hike of 50bps', 'Global liquidity shock'],
      invalidation_triggers: ['Break below 200 EMA at 22,000'],
    };

    it('validates a valid Round 3 signal', () => {
      const parsed = Round3SignalSchema.parse(validRound3);
      expect(parsed.round).toBe(3);
      expect(parsed.is_devils_advocate).toBe(true);
      expect(parsed.catastrophic_risks).toHaveLength(2);
      expect(parsed.invalidation_triggers).toHaveLength(1);
    });

    it('rejects round != 3', () => {
      expect(() =>
        Round3SignalSchema.parse({
          ...validRound3,
          round: 2,
        }),
      ).toThrow();
    });

    it('rejects empty catastrophic_risks or invalidation_triggers', () => {
      expect(() =>
        Round3SignalSchema.parse({
          ...validRound3,
          catastrophic_risks: [],
        }),
      ).toThrow();

      expect(() =>
        Round3SignalSchema.parse({
          ...validRound3,
          invalidation_triggers: [],
        }),
      ).toThrow();
    });

    it('rejects extra fields (.strict())', () => {
      expect(() =>
        Round3SignalSchema.parse({
          ...validRound3,
          unwanted: true,
        }),
      ).toThrow();
    });
  });

  describe('ScenarioDetailSchema and ScenarioSynthesisSchema', () => {
    const validBullCase = {
      primary_advocate: 'price' as const,
      direction: 'up' as const,
      probability: 0.7,
      confidence: 0.85,
      primary_evidence_claims: ['Breakout above resistance'],
      catastrophic_risks: ['Sudden geopolitical escalation'],
      invalidation_triggers: ['Close below 21,800'],
      dissent: 'FII agent remains skeptical due to net outflows',
    };

    const validBearCase = {
      primary_advocate: 'fii' as const,
      direction: 'down' as const,
      probability: 0.7,
      confidence: 0.65,
      primary_evidence_claims: ['Heavy index futures short positions'],
      catastrophic_risks: ['Short squeeze on unexpected policy easing'],
      invalidation_triggers: ['Break above 22,500'],
    };

    it('validates valid scenario details and synthesis', () => {
      const bullParsed = ScenarioDetailSchema.parse(validBullCase);
      expect(bullParsed.primary_advocate).toBe('price');
      expect(bullParsed.dissent).toBeDefined();

      const bearParsed = ScenarioDetailSchema.parse(validBearCase);
      expect(bearParsed.dissent).toBeUndefined();

      const synthesisParsed = ScenarioSynthesisSchema.parse({
        bull_case: validBullCase,
        bear_case: validBearCase,
      });
      expect(synthesisParsed.bull_case.direction).toBe('up');
      expect(synthesisParsed.bear_case.direction).toBe('down');
    });

    it('rejects invalid scenario details', () => {
      expect(() =>
        ScenarioDetailSchema.parse({
          ...validBullCase,
          probability: 1.5,
        }),
      ).toThrow();

      expect(() =>
        ScenarioDetailSchema.parse({
          ...validBullCase,
          primary_evidence_claims: [],
        }),
      ).toThrow();

      expect(() =>
        ScenarioSynthesisSchema.parse({
          bull_case: validBullCase,
          bear_case: {
            ...validBearCase,
            direction: 'sideways',
          },
        }),
      ).toThrow();
    });
  });

  describe('ParticipantWeightsSchema', () => {
    it('validates weights that sum to 1.0', () => {
      const equalWeights = { price: 0.25, fii: 0.25, dii: 0.25, retail: 0.25 };
      expect(ParticipantWeightsSchema.parse(equalWeights)).toEqual(equalWeights);

      const customWeights = { price: 0.35, fii: 0.25, dii: 0.25, retail: 0.15 };
      expect(ParticipantWeightsSchema.parse(customWeights)).toEqual(customWeights);
    });

    it('rejects weights that do not sum to 1.0', () => {
      expect(() =>
        ParticipantWeightsSchema.parse({
          price: 0.2,
          fii: 0.2,
          dii: 0.2,
          retail: 0.2,
        }),
      ).toThrow(/must sum to 1\.0/);

      expect(() =>
        ParticipantWeightsSchema.parse({
          price: 0.5,
          fii: 0.5,
          dii: 0.5,
          retail: 0.5,
        }),
      ).toThrow(/must sum to 1\.0/);
    });

    it('rejects negative weights or weights > 1', () => {
      expect(() =>
        ParticipantWeightsSchema.parse({
          price: -0.1,
          fii: 0.5,
          dii: 0.3,
          retail: 0.3,
        }),
      ).toThrow();
    });

    it('rejects extra keys (.strict())', () => {
      expect(() =>
        ParticipantWeightsSchema.parse({
          price: 0.25,
          fii: 0.25,
          dii: 0.25,
          retail: 0.25,
          macro: 0.0,
        }),
      ).toThrow();
    });
  });

  describe('SignalsByRoundSchema and DebateConsensusSchema', () => {
    const makeRound1 = (name: 'price' | 'fii' | 'dii' | 'retail') => ({
      ...validBaseSignal,
      agent_name: name,
    });

    const makeRound2 = (name: 'price' | 'fii' | 'dii' | 'retail') => ({
      ...validBaseSignal,
      agent_name: name,
      round: 2 as const,
      critiques: [
        {
          target_agent: 'price' as const,
          agreement_level: 'agree' as const,
          critique_point: 'Valid point',
        },
      ],
      probability_delta: 0.0,
    });

    const makeRound3 = (name: 'price' | 'fii' | 'dii' | 'retail') => ({
      ...validBaseSignal,
      agent_name: name,
      round: 3 as const,
      is_devils_advocate: false,
      catastrophic_risks: ['Risk 1'],
      invalidation_triggers: ['Trigger 1'],
    });

    const validSignalsByRound = {
      round1: {
        price: makeRound1('price'),
        fii: makeRound1('fii'),
        dii: makeRound1('dii'),
        retail: makeRound1('retail'),
      },
      round2: {
        price: makeRound2('price'),
        fii: makeRound2('fii'),
        dii: makeRound2('dii'),
        retail: makeRound2('retail'),
      },
      round3: {
        price: makeRound3('price'),
        fii: makeRound3('fii'),
        dii: makeRound3('dii'),
        retail: makeRound3('retail'),
      },
    };

    it('validates valid SignalsByRound structure', () => {
      const parsed = SignalsByRoundSchema.parse(validSignalsByRound);
      expect(parsed.round1.price.agent_name).toBe('price');
      expect(parsed.round2.fii.round).toBe(2);
      expect(parsed.round3.dii.round).toBe(3);
    });

    it('validates a complete DebateConsensus with scenarios', () => {
      const validConsensus = {
        symbol: 'TCS.NS',
        as_of: '2026-08-17T10:00:00.000Z',
        direction: 'up' as const,
        consensus_probability: 0.72,
        consensus_confidence: 0.8,
        dispersion: 0.08,
        is_deadlocked: false,
        weights: { price: 0.35, fii: 0.25, dii: 0.25, retail: 0.15 },
        signals_by_round: validSignalsByRound,
        scenarios: {
          bull_case: {
            primary_advocate: 'price' as const,
            direction: 'up' as const,
            probability: 0.75,
            confidence: 0.85,
            primary_evidence_claims: ['EMA Golden Cross'],
            catastrophic_risks: ['Earnings miss'],
            invalidation_triggers: ['Support break at 3800'],
          },
          bear_case: {
            primary_advocate: 'fii' as const,
            direction: 'down' as const,
            probability: 0.75,
            confidence: 0.6,
            primary_evidence_claims: ['Global tech selloff'],
            catastrophic_risks: ['US recession'],
            invalidation_triggers: ['Break above 4200'],
          },
        },
      };

      const parsed = DebateConsensusSchema.parse(validConsensus);
      expect(parsed.symbol).toBe('TCS.NS');
      expect(parsed.consensus_probability).toBe(0.72);
      expect(parsed.scenarios).toBeDefined();
    });

    it('validates DebateConsensus without optional scenarios', () => {
      const consensusWithoutScenarios = {
        symbol: 'INFY.NS',
        as_of: '2026-08-17T10:00:00.000Z',
        direction: 'down' as const,
        consensus_probability: 0.65,
        consensus_confidence: 0.7,
        dispersion: 0.12,
        is_deadlocked: false,
        weights: { price: 0.25, fii: 0.25, dii: 0.25, retail: 0.25 },
        signals_by_round: validSignalsByRound,
      };

      const parsed = DebateConsensusSchema.parse(consensusWithoutScenarios);
      expect(parsed.scenarios).toBeUndefined();
    });

    it('rejects invalid as_of format', () => {
      const invalidConsensus = {
        symbol: 'TCS.NS',
        as_of: 'not-a-datetime',
        direction: 'up',
        consensus_probability: 0.72,
        consensus_confidence: 0.8,
        dispersion: 0.08,
        is_deadlocked: false,
        weights: { price: 0.25, fii: 0.25, dii: 0.25, retail: 0.25 },
        signals_by_round: validSignalsByRound,
      };
      expect(() => DebateConsensusSchema.parse(invalidConsensus)).toThrow();
    });

    it('rejects probability out of bounds or extra fields', () => {
      const invalidConsensus = {
        symbol: 'TCS.NS',
        as_of: '2026-08-17T10:00:00.000Z',
        direction: 'up',
        consensus_probability: 1.5,
        consensus_confidence: 0.8,
        dispersion: 0.08,
        is_deadlocked: false,
        weights: { price: 0.25, fii: 0.25, dii: 0.25, retail: 0.25 },
        signals_by_round: validSignalsByRound,
      };
      expect(() => DebateConsensusSchema.parse(invalidConsensus)).toThrow();

      const extraFieldConsensus = {
        ...invalidConsensus,
        consensus_probability: 0.7,
        extra_key: 'invalid',
      };
      expect(() => DebateConsensusSchema.parse(extraFieldConsensus)).toThrow();
    });
  });
});
