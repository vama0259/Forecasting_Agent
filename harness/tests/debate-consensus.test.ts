import { describe, it, expect } from 'vitest';
import { normalizeToPUp, calculateConsensus, type CalculateConsensusParams } from '../src/debate/consensus.js';
import {
  DebateConsensusSchema,
  type SignalsByRound,
  type Round2Signal,
  type Round3Signal,
} from '../src/debate/types.js';
import type { AgentSignal } from '../src/agents/schema.js';

describe('Deterministic Arithmetic Consensus Engine', () => {
  const baseEvidence = [
    {
      claim: 'Price 20 EMA crossover above 50 EMA',
      source_capability: 'market_data' as const,
      value: 22450.5,
      explicit_absence: false,
    },
  ];

  const makeR1 = (
    name: 'price' | 'fii' | 'dii' | 'retail',
    direction: 'up' | 'down' = 'up',
    probability = 0.7,
    confidence = 0.8,
    degraded = false,
  ): AgentSignal => ({
    agent_name: name,
    direction,
    probability,
    confidence,
    horizon_days: 1,
    evidence: baseEvidence,
    degraded,
  });

  const makeR2 = (
    name: 'price' | 'fii' | 'dii' | 'retail',
    direction: 'up' | 'down' = 'up',
    probability = 0.7,
    confidence = 0.8,
    degraded = false,
  ): Round2Signal => ({
    agent_name: name,
    direction,
    probability,
    confidence,
    horizon_days: 1,
    evidence: baseEvidence,
    degraded,
    round: 2,
    critiques: [
      {
        target_agent: 'retail',
        agreement_level: 'disagree',
        critique_point: 'Flows counter retail sentiment',
      },
    ],
    probability_delta: 0.0,
  });

  const makeR3 = (
    name: 'price' | 'fii' | 'dii' | 'retail',
    direction: 'up' | 'down' = 'up',
    probability = 0.7,
    confidence = 0.8,
    degraded = false,
    catastrophic_risks: string[] = ['Unexpected policy rate shock'],
    invalidation_triggers: string[] = ['Break of key support at 22,000'],
    dissent?: string,
  ): Round3Signal => ({
    agent_name: name,
    direction,
    probability,
    confidence,
    horizon_days: 1,
    evidence: [
      {
        claim: `${name} primary evidence for ${direction}`,
        source_capability: 'market_data',
        value: 100,
        explicit_absence: false,
      },
    ],
    degraded,
    round: 3,
    is_devils_advocate: false,
    catastrophic_risks,
    invalidation_triggers,
    dissent,
  });

  const createMockSignals = (
    r3Overrides: Partial<Record<'price' | 'fii' | 'dii' | 'retail', Round3Signal>> = {},
  ): SignalsByRound => ({
    round1: {
      price: makeR1('price'),
      fii: makeR1('fii'),
      dii: makeR1('dii'),
      retail: makeR1('retail'),
    },
    round2: {
      price: makeR2('price'),
      fii: makeR2('fii'),
      dii: makeR2('dii'),
      retail: makeR2('retail'),
    },
    round3: {
      price: r3Overrides.price ?? makeR3('price'),
      fii: r3Overrides.fii ?? makeR3('fii'),
      dii: r3Overrides.dii ?? makeR3('dii'),
      retail: r3Overrides.retail ?? makeR3('retail'),
    },
  });

  describe('1. Canonical Directional Normalization (normalizeToPUp)', () => {
    it('correctly normalizes directional probabilities to P(up)', () => {
      expect(normalizeToPUp('up', 0.8)).toBe(0.8);
      expect(normalizeToPUp('down', 0.8)).toBeCloseTo(0.2, 8);
      expect(normalizeToPUp('up', 0.5)).toBe(0.5);
      expect(normalizeToPUp('down', 0.5)).toBe(0.5);
      expect(normalizeToPUp('down', 0.1)).toBeCloseTo(0.9, 8);
      expect(normalizeToPUp('up', 1.0)).toBe(1.0);
      expect(normalizeToPUp('down', 1.0)).toBe(0.0);
    });
  });

  describe('2. Dispersion with Opposing Directions', () => {
    it('yields high dispersion (~0.30) when agents take opposing 0.8 directions', () => {
      // 2 agents vote 'up' 0.8 (P(up) = 0.8), 2 agents vote 'down' 0.8 (P(up) = 0.2)
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.8, 0.8),
        fii: makeR3('fii', 'down', 0.8, 0.8),
        dii: makeR3('dii', 'up', 0.8, 0.8),
        retail: makeR3('retail', 'down', 0.8, 0.8),
      });

      const params: CalculateConsensusParams = {
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      };

      const result = calculateConsensus(params);

      // P(up) consensus = 0.25*0.8 + 0.25*0.2 + 0.25*0.8 + 0.25*0.2 = 0.50
      // Variance = 0.25*(0.8-0.5)^2 * 2 + 0.25*(0.2-0.5)^2 * 2 = 0.09
      // Dispersion = sqrt(0.09) = 0.30
      expect(result.dispersion).toBeCloseTo(0.3, 6);
      expect(result.is_deadlocked).toBe(true);
      expect(result.consensus_probability).toBeCloseTo(0.5, 6);
    });
  });

  describe('3. Degradation Scaling & Health Factor', () => {
    it('applies health factor H = 1.0 when all agents are healthy', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.7, 0.8, false),
        fii: makeR3('fii', 'up', 0.7, 0.8, false),
        dii: makeR3('dii', 'up', 0.7, 0.8, false),
        retail: makeR3('retail', 'up', 0.7, 0.8, false),
      });

      const result = calculateConsensus({
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      expect(result.consensus_confidence).toBeCloseTo(0.8, 6);
      expect(result.weights).toEqual({
        price: 0.25,
        fii: 0.25,
        dii: 0.25,
        retail: 0.25,
      });
    });

    it('scales weights and discounts confidence when 2 of 4 agents are degraded (H = 0.75)', () => {
      // price and fii degraded, dii and retail healthy
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.7, 0.8, true),
        fii: makeR3('fii', 'up', 0.7, 0.8, true),
        dii: makeR3('dii', 'up', 0.7, 0.8, false),
        retail: makeR3('retail', 'up', 0.7, 0.8, false),
      });

      const result = calculateConsensus({
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      // w = [0.125, 0.125, 0.25, 0.25], sum = 0.75, H = 0.75 / 1.0 = 0.75
      // normalized weights: price=1/6, fii=1/6, dii=1/3, retail=1/3
      expect(result.weights.price).toBeCloseTo(1 / 6, 6);
      expect(result.weights.fii).toBeCloseTo(1 / 6, 6);
      expect(result.weights.dii).toBeCloseTo(1 / 3, 6);
      expect(result.weights.retail).toBeCloseTo(1 / 3, 6);

      // C_consensus = (sum(w_hat * 0.8)) * H = 0.8 * 0.75 = 0.60
      expect(result.consensus_confidence).toBeCloseTo(0.6, 6);
    });

    it('halves confidence when all 4 agents are degraded (H = 0.5)', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.7, 0.8, true),
        fii: makeR3('fii', 'up', 0.7, 0.8, true),
        dii: makeR3('dii', 'up', 0.7, 0.8, true),
        retail: makeR3('retail', 'up', 0.7, 0.8, true),
      });

      const result = calculateConsensus({
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      // w = [0.125, 0.125, 0.125, 0.125], sum = 0.5, H = 0.5
      // normalized weights = 0.25 each
      expect(result.weights.price).toBeCloseTo(0.25, 6);
      expect(result.weights.fii).toBeCloseTo(0.25, 6);
      expect(result.weights.dii).toBeCloseTo(0.25, 6);
      expect(result.weights.retail).toBeCloseTo(0.25, 6);

      // C_consensus = 0.8 * 0.5 = 0.40
      expect(result.consensus_confidence).toBeCloseTo(0.4, 6);
    });
  });

  describe('4. Historical Brier Weights', () => {
    it('allocates proportionately higher weights to agents with better (lower) Brier scores', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.7, 0.8),
        fii: makeR3('fii', 'up', 0.7, 0.8),
        dii: makeR3('dii', 'up', 0.7, 0.8),
        retail: makeR3('retail', 'up', 0.7, 0.8),
      });

      // Brier scores: price=0.1 (raw=0.9), fii=0.2 (raw=0.8), dii=0.3 (raw=0.7), retail=0.4 (raw=0.6)
      // Total raw = 3.0
      // Base weights: price=0.3, fii=0.8/3 (~0.2667), dii=0.7/3 (~0.2333), retail=0.2
      const result = calculateConsensus({
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
        historicalBrier: {
          price: 0.1,
          fii: 0.2,
          dii: 0.3,
          retail: 0.4,
        },
      });

      expect(result.weights.price).toBeCloseTo(0.9 / 3.0, 6);
      expect(result.weights.fii).toBeCloseTo(0.8 / 3.0, 6);
      expect(result.weights.dii).toBeCloseTo(0.7 / 3.0, 6);
      expect(result.weights.retail).toBeCloseTo(0.6 / 3.0, 6);
      expect(result.weights.price).toBeGreaterThan(result.weights.retail);
    });

    it('handles zero-safe division when all Brier scores are 1.0 or higher', () => {
      const signals = createMockSignals();

      const result = calculateConsensus({
        symbol: 'NIFTY50',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
        historicalBrier: {
          price: 1.0,
          fii: 1.0,
          dii: 1.0,
          retail: 1.0,
        },
      });

      // raw_weight = max(0.001, 1 - 1.0) = 0.001 each
      // denom = 0.004 -> weights are 0.25 each
      expect(result.weights.price).toBeCloseTo(0.25, 6);
      expect(result.weights.fii).toBeCloseTo(0.25, 6);
      expect(result.weights.dii).toBeCloseTo(0.25, 6);
      expect(result.weights.retail).toBeCloseTo(0.25, 6);
    });
  });

  describe('5. Deadlock Detection & Dual-Scenario Extraction', () => {
    it('triggers deadlock when dispersion >= 0.18 and synthesizes bull and bear scenarios', () => {
      const priceR3 = makeR3(
        'price',
        'up',
        0.85,
        0.9,
        false,
        ['Macro liquidity drying up'],
        ['Break below 22,100'],
        'Retail agent seems over-optimistic',
      );
      const fiiR3 = makeR3(
        'fii',
        'down',
        0.8,
        0.85,
        false,
        ['Short squeeze risk on index derivatives'],
        ['Break above 22,800'],
        'Price agent ignores heavy cash selling',
      );
      const diiR3 = makeR3('dii', 'up', 0.6, 0.7);
      const retailR3 = makeR3('retail', 'down', 0.65, 0.6);

      const signals = createMockSignals({
        price: priceR3,
        fii: fiiR3,
        dii: diiR3,
        retail: retailR3,
      });

      const result = calculateConsensus({
        symbol: 'RELIANCE.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      expect(result.is_deadlocked).toBe(true);
      expect(result.scenarios).toBeDefined();

      // Highest P(up): price has up 0.85 -> P(up) = 0.85
      // Lowest P(up): fii has down 0.80 -> P(up) = 0.20
      const scenarios = result.scenarios!;
      expect(scenarios.bull_case.primary_advocate).toBe('price');
      expect(scenarios.bull_case.direction).toBe('up');
      expect(scenarios.bull_case.probability).toBe(0.85);
      expect(scenarios.bull_case.confidence).toBe(0.9);
      expect(scenarios.bull_case.primary_evidence_claims).toEqual(['price primary evidence for up']);
      expect(scenarios.bull_case.catastrophic_risks).toEqual(['Macro liquidity drying up']);
      expect(scenarios.bull_case.invalidation_triggers).toEqual(['Break below 22,100']);
      expect(scenarios.bull_case.dissent).toBe('Retail agent seems over-optimistic');

      expect(scenarios.bear_case.primary_advocate).toBe('fii');
      expect(scenarios.bear_case.direction).toBe('down');
      expect(scenarios.bear_case.probability).toBe(0.8);
      expect(scenarios.bear_case.confidence).toBe(0.85);
      expect(scenarios.bear_case.primary_evidence_claims).toEqual(['fii primary evidence for down']);
      expect(scenarios.bear_case.catastrophic_risks).toEqual(['Short squeeze risk on index derivatives']);
      expect(scenarios.bear_case.invalidation_triggers).toEqual(['Break above 22,800']);
      expect(scenarios.bear_case.dissent).toBe('Price agent ignores heavy cash selling');
    });

    it('triggers deadlock when consensus probability is in ambiguous range [0.46, 0.54]', () => {
      // Even if dispersion is below 0.18 (e.g. all clustered around 0.50), ambiguous consensus triggers deadlock
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.51, 0.7),
        fii: makeR3('fii', 'up', 0.49, 0.7),
        dii: makeR3('dii', 'up', 0.5, 0.7),
        retail: makeR3('retail', 'up', 0.52, 0.7),
      });

      const result = calculateConsensus({
        symbol: 'TCS.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      // P(up) consensus = 0.505 (in [0.46, 0.54])
      expect(result.is_deadlocked).toBe(true);
      expect(result.scenarios).toBeDefined();
    });

    it('does not trigger deadlock when strong consensus exists (dispersion < 0.18 and outside ambiguous zone)', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.8, 0.85),
        fii: makeR3('fii', 'up', 0.75, 0.8),
        dii: makeR3('dii', 'up', 0.78, 0.8),
        retail: makeR3('retail', 'up', 0.82, 0.9),
      });

      const result = calculateConsensus({
        symbol: 'INFY.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      expect(result.is_deadlocked).toBe(false);
      expect(result.scenarios).toBeUndefined();
      expect(result.direction).toBe('up');
      expect(result.consensus_probability).toBeCloseTo(0.7875, 4);
    });
  });

  describe('6. Direction and Schema Conformance', () => {
    it('correctly sets direction to down and calibrates output probability when consensus is down', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'down', 0.75, 0.8),
        fii: makeR3('fii', 'down', 0.7, 0.8),
        dii: makeR3('dii', 'down', 0.8, 0.8),
        retail: makeR3('retail', 'down', 0.75, 0.8),
      });

      const result = calculateConsensus({
        symbol: 'HDFCBANK.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      // P(up)_i = [0.25, 0.30, 0.20, 0.25]
      // P(up)_consensus = 0.25
      // Direction = 'down' (since 0.25 < 0.50)
      // Calibrated output probability = 1.0 - 0.25 = 0.75
      expect(result.direction).toBe('down');
      expect(result.consensus_probability).toBeCloseTo(0.75, 6);
      expect(result.is_deadlocked).toBe(false);
      expect(DebateConsensusSchema.parse(result)).toEqual(result);
    });

    it('resolves tie at exactly 0.50 to direction "up"', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.5, 0.8),
        fii: makeR3('fii', 'up', 0.5, 0.8),
        dii: makeR3('dii', 'down', 0.5, 0.8),
        retail: makeR3('retail', 'down', 0.5, 0.8),
      });

      const result = calculateConsensus({
        symbol: 'ITC.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      expect(result.direction).toBe('up');
      expect(result.consensus_probability).toBe(0.5);
      expect(DebateConsensusSchema.parse(result)).toEqual(result);
    });

    it('passes strict zod schema parsing on deadlocked consensus with scenarios', () => {
      const signals = createMockSignals({
        price: makeR3('price', 'up', 0.9, 0.95),
        fii: makeR3('fii', 'down', 0.9, 0.95),
        dii: makeR3('dii', 'up', 0.85, 0.8),
        retail: makeR3('retail', 'down', 0.85, 0.8),
      });

      const result = calculateConsensus({
        symbol: 'SBIN.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        signalsByRound: signals,
      });

      const parsed = DebateConsensusSchema.parse(result);
      expect(parsed).toEqual(result);
      expect(parsed.scenarios).toBeDefined();
      expect(parsed.scenarios?.bull_case.primary_advocate).toBe('price');
      expect(parsed.scenarios?.bear_case.primary_advocate).toBe('fii');
    });
  });
});
