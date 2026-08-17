import { describe, it, expect, vi } from 'vitest';
import { runDebate, type ParticipantAgentName } from '../src/debate/orchestrator.js';
import { DebateConsensusSchema, type Round2Signal, type Round3Signal } from '../src/debate/types.js';
import type { AgentSignal } from '../src/agents/schema.js';
import type { DebateRoundRecord } from '../src/storage/postgres-store.js';

describe('Debate Deadlock & Dual-Scenario Extraction', () => {
  const baseEvidence = [
    {
      claim: 'Strong volume breakout at multi-month resistance',
      source_capability: 'market_data' as const,
      value: 2450.0,
      explicit_absence: false,
    },
  ];

  const makeR1 = (name: ParticipantAgentName, direction: 'up' | 'down', probability: number): AgentSignal => ({
    agent_name: name,
    direction,
    probability,
    confidence: 0.85,
    horizon_days: 1,
    evidence: baseEvidence,
    degraded: false,
  });

  const makeR2 = (name: ParticipantAgentName, direction: 'up' | 'down', probability: number): Round2Signal => ({
    agent_name: name,
    direction,
    probability,
    confidence: 0.85,
    horizon_days: 1,
    evidence: baseEvidence,
    degraded: false,
    round: 2,
    critiques: [
      {
        target_agent: direction === 'up' ? 'fii' : 'price',
        agreement_level: 'strongly_oppose',
        critique_point: `${name} strongly rejects counter-party hypothesis`,
      },
    ],
    probability_delta: 0.0,
  });

  const makeR3 = (
    name: ParticipantAgentName,
    direction: 'up' | 'down',
    probability: number,
    is_devils_advocate = false,
    catastrophic_risks: string[] = [`${name} catastrophic structural failure risk`],
    invalidation_triggers: string[] = [`${name} critical support/resistance invalidation trigger`],
    dissent?: string,
  ): Round3Signal => ({
    agent_name: name,
    direction,
    probability,
    confidence: 0.85,
    horizon_days: 1,
    evidence: [
      {
        claim: `${name} primary evidence for ${direction}`,
        source_capability: 'market_data',
        value: 100,
        explicit_absence: false,
      },
    ],
    degraded: false,
    round: 3,
    is_devils_advocate,
    catastrophic_risks,
    invalidation_triggers,
    dissent,
  });

  it('triggers deadlock when opposing high-conviction signals cause dispersion >= 0.18', async () => {
    // 2 agents strongly UP (price=0.90, dii=0.85)
    // 2 agents strongly DOWN (fii=0.88, retail=0.82)
    const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
      if (round === 1) {
        if (agentName === 'price') return makeR1('price', 'up', 0.9);
        if (agentName === 'dii') return makeR1('dii', 'up', 0.85);
        if (agentName === 'fii') return makeR1('fii', 'down', 0.88);
        return makeR1('retail', 'down', 0.82);
      } else if (round === 2) {
        if (agentName === 'price') return makeR2('price', 'up', 0.9);
        if (agentName === 'dii') return makeR2('dii', 'up', 0.85);
        if (agentName === 'fii') return makeR2('fii', 'down', 0.88);
        return makeR2('retail', 'down', 0.82);
      } else {
        if (agentName === 'price') {
          return makeR3(
            'price',
            'up',
            0.9,
            isDevilsAdvocate,
            ['Macro liquidity squeeze'],
            ['Break below 22,000'],
            'FII and Retail are heavily biased towards bearish derivative positioning',
          );
        }
        if (agentName === 'dii') {
          return makeR3('dii', 'up', 0.85, isDevilsAdvocate, ['Domestic fund redemption wave'], ['Break below 22,200']);
        }
        if (agentName === 'fii') {
          return makeR3(
            'fii',
            'down',
            0.88,
            isDevilsAdvocate,
            ['Cross-border dollar liquidity shock'],
            ['Break above 23,000'],
            'Price action ignores massive institutional cash outflow',
          );
        }
        return makeR3('retail', 'down', 0.82, isDevilsAdvocate, ['Retail option call trap'], ['Break above 22,900']);
      }
    });

    const consensus = await runDebate({
      symbol: 'TCS.NS',
      asOf: '2026-08-17T10:00:00.000Z',
      invoker: mockInvoker,
    });

    // P(up)_price = 0.90, P(up)_dii = 0.85
    // P(up)_fii = 0.12, P(up)_retail = 0.18
    // P(up)_consensus = (0.90 + 0.85 + 0.12 + 0.18) / 4 = 0.5125
    // Dispersion = sqrt(0.25 * ((0.9-0.5125)^2 + (0.85-0.5125)^2 + (0.12-0.5125)^2 + (0.18-0.5125)^2)) = ~0.354 >= 0.18
    expect(consensus.is_deadlocked).toBe(true);
    expect(consensus.dispersion).toBeGreaterThanOrEqual(0.18);
    expect(consensus.scenarios).toBeDefined();

    const scenarios = consensus.scenarios!;
    // Top Bull Advocate: price (P(up) = 0.90)
    expect(scenarios.bull_case.primary_advocate).toBe('price');
    expect(scenarios.bull_case.direction).toBe('up');
    expect(scenarios.bull_case.probability).toBe(0.9);
    expect(scenarios.bull_case.confidence).toBe(0.85);
    expect(scenarios.bull_case.catastrophic_risks).toEqual(['Macro liquidity squeeze']);
    expect(scenarios.bull_case.invalidation_triggers).toEqual(['Break below 22,000']);
    expect(scenarios.bull_case.dissent).toBe(
      'FII and Retail are heavily biased towards bearish derivative positioning',
    );

    // Top Bear Advocate: fii (lowest P(up) = 0.12)
    expect(scenarios.bear_case.primary_advocate).toBe('fii');
    expect(scenarios.bear_case.direction).toBe('down');
    expect(scenarios.bear_case.probability).toBe(0.88);
    expect(scenarios.bear_case.confidence).toBe(0.85);
    expect(scenarios.bear_case.catastrophic_risks).toEqual(['Cross-border dollar liquidity shock']);
    expect(scenarios.bear_case.invalidation_triggers).toEqual(['Break above 23,000']);
    expect(scenarios.bear_case.dissent).toBe('Price action ignores massive institutional cash outflow');

    // Validates against strict DebateConsensusSchema
    expect(DebateConsensusSchema.parse(consensus)).toEqual(consensus);
  });

  it('triggers deadlock when consensus probability falls into ambiguous zone [0.46, 0.54]', async () => {
    // Agents are clustered near 0.50 (e.g. low dispersion ~0.02, but consensus P(up) = 0.50)
    const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
      if (round === 1) {
        if (agentName === 'price') return makeR1('price', 'up', 0.52);
        if (agentName === 'dii') return makeR1('dii', 'up', 0.51);
        if (agentName === 'fii') return makeR1('fii', 'down', 0.51);
        return makeR1('retail', 'down', 0.52);
      } else if (round === 2) {
        if (agentName === 'price') return makeR2('price', 'up', 0.52);
        if (agentName === 'dii') return makeR2('dii', 'up', 0.51);
        if (agentName === 'fii') return makeR2('fii', 'down', 0.51);
        return makeR2('retail', 'down', 0.52);
      } else {
        if (agentName === 'price') return makeR3('price', 'up', 0.52, isDevilsAdvocate);
        if (agentName === 'dii') return makeR3('dii', 'up', 0.51, isDevilsAdvocate);
        if (agentName === 'fii') return makeR3('fii', 'down', 0.51, isDevilsAdvocate);
        return makeR3('retail', 'down', 0.52, isDevilsAdvocate);
      }
    });

    const consensus = await runDebate({
      symbol: 'INFY.NS',
      asOf: '2026-08-17T10:00:00.000Z',
      invoker: mockInvoker,
    });

    // P(up) consensus = (0.52 + 0.51 + 0.49 + 0.48) / 4 = 0.50 (in [0.46, 0.54])
    expect(consensus.is_deadlocked).toBe(true);
    expect(consensus.scenarios).toBeDefined();
    expect(consensus.scenarios?.bull_case.primary_advocate).toBe('price');
    expect(consensus.scenarios?.bear_case.primary_advocate).toBe('retail');
  });

  it('does not trigger deadlock when strong majority consensus is achieved', async () => {
    // All 4 agents agree on UP with high probability
    const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
      if (round === 1) {
        return makeR1(agentName, 'up', 0.85);
      } else if (round === 2) {
        return makeR2(agentName, 'up', 0.85);
      } else {
        return makeR3(agentName, 'up', 0.85, isDevilsAdvocate);
      }
    });

    const consensus = await runDebate({
      symbol: 'RELIANCE.NS',
      asOf: '2026-08-17T10:00:00.000Z',
      invoker: mockInvoker,
    });

    expect(consensus.is_deadlocked).toBe(false);
    expect(consensus.scenarios).toBeUndefined();
    expect(consensus.direction).toBe('up');
    expect(consensus.consensus_probability).toBeCloseTo(0.85, 4);
    expect(consensus.dispersion).toBeCloseTo(0.0, 4);
  });

  it('persists deadlocked consensus with dual scenarios in PostgreSQL store', async () => {
    const savedRecords: DebateRoundRecord[] = [];
    const mockStore = {
      saveDebateRound: vi.fn(async (record: DebateRoundRecord) => {
        savedRecords.push(record);
      }),
    };

    const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
      if (round === 1) {
        return agentName === 'price' || agentName === 'dii'
          ? makeR1(agentName, 'up', 0.85)
          : makeR1(agentName, 'down', 0.85);
      } else if (round === 2) {
        return agentName === 'price' || agentName === 'dii'
          ? makeR2(agentName, 'up', 0.85)
          : makeR2(agentName, 'down', 0.85);
      } else {
        return agentName === 'price' || agentName === 'dii'
          ? makeR3(agentName, 'up', 0.85, isDevilsAdvocate)
          : makeR3(agentName, 'down', 0.85, isDevilsAdvocate);
      }
    });

    const consensus = await runDebate({
      symbol: 'SBIN.NS',
      asOf: '2026-08-17T12:00:00.000Z',
      forecastId: '22222222-2222-2222-2222-222222222222',
      invoker: mockInvoker,
      store: mockStore,
    });

    expect(consensus.is_deadlocked).toBe(true);

    const r4 = savedRecords.find((r) => r.roundNumber === 4);
    expect(r4).toBeDefined();
    expect(r4?.agentName).toBe('consensus');
    expect(r4?.payload).toBeDefined();

    const payload = r4?.payload as Record<string, unknown>;
    expect(payload.is_deadlocked).toBe(true);
    expect(payload.scenarios).toBeDefined();
  });
});
