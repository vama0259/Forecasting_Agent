import { describe, it, expect, vi } from 'vitest';
import {
  selectDevilsAdvocate,
  runDebate,
  DebateOrchestrator,
  renderRound2Prompt,
  renderRound3Prompt,
  type ParticipantAgentName,
} from '../src/debate/orchestrator.js';
import { DebateConsensusSchema, type Round2Signal, type Round3Signal } from '../src/debate/types.js';
import type { AgentSignal } from '../src/agents/schema.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';
import type { DebateRoundRecord } from '../src/storage/postgres-store.js';

describe('Debate Orchestrator & Multi-Round Protocol', () => {
  const baseEvidence = [
    {
      claim: 'EMA Golden Cross with strong volume confirmation',
      source_capability: 'market_data' as const,
      value: 2450.0,
      explicit_absence: false,
    },
  ];

  const makeR1 = (
    name: ParticipantAgentName,
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
    name: ParticipantAgentName,
    direction: 'up' | 'down' = 'up',
    probability = 0.7,
    confidence = 0.8,
    degraded = false,
    probability_delta = 0.0,
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
        critique_point: `${name} challenges retail positioning assumptions`,
      },
    ],
    probability_delta,
  });

  const makeR3 = (
    name: ParticipantAgentName,
    direction: 'up' | 'down' = 'up',
    probability = 0.7,
    confidence = 0.8,
    is_devils_advocate = false,
    degraded = false,
  ): Round3Signal => ({
    agent_name: name,
    direction,
    probability,
    confidence,
    horizon_days: 1,
    evidence: [
      {
        claim: `${name} final R3 claim for ${direction}`,
        source_capability: 'market_data',
        value: 100,
        explicit_absence: false,
      },
    ],
    degraded,
    round: 3,
    is_devils_advocate,
    catastrophic_risks: [`${name} tail risk`],
    invalidation_triggers: [`${name} price trigger`],
  });

  describe('1. selectDevilsAdvocate Algorithm', () => {
    it('selects agent with lowest P(up) when majority direction is up', () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'up', 0.85), // P(up) = 0.85, D = 0.15
        fii: makeR2('fii', 'down', 0.8), // P(up) = 0.20, D = 0.80
        dii: makeR2('dii', 'up', 0.7), // P(up) = 0.70, D = 0.30
        retail: makeR2('retail', 'up', 0.6), // P(up) = 0.60, D = 0.40
      };

      const result = selectDevilsAdvocate(r2Signals);
      // avg P(up) = (0.85 + 0.20 + 0.70 + 0.60) / 4 = 0.5875 -> majority 'up'
      expect(result.majorityDirection).toBe('up');
      expect(result.avgPUp).toBeCloseTo(0.5875, 4);
      expect(result.devilsAdvocate).toBe('fii');
    });

    it('selects agent with highest P(up) when majority direction is down', () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'down', 0.8), // P(up) = 0.20, D = 0.20
        fii: makeR2('fii', 'down', 0.7), // P(up) = 0.30, D = 0.30
        dii: makeR2('dii', 'up', 0.65), // P(up) = 0.65, D = 0.65
        retail: makeR2('retail', 'down', 0.6), // P(up) = 0.40, D = 0.40
      };

      const result = selectDevilsAdvocate(r2Signals);
      // avg P(up) = (0.20 + 0.30 + 0.65 + 0.40) / 4 = 0.3875 -> majority 'down'
      expect(result.majorityDirection).toBe('down');
      expect(result.avgPUp).toBeCloseTo(0.3875, 4);
      expect(result.devilsAdvocate).toBe('dii');
    });

    describe('Tie-breaking priority: retail -> fii -> dii -> price', () => {
      it('breaks tie between retail and fii in favor of retail', () => {
        const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
          price: makeR2('price', 'up', 0.8), // P(up) = 0.8, D = 0.2
          fii: makeR2('fii', 'down', 0.8), // P(up) = 0.2, D = 0.8
          dii: makeR2('dii', 'up', 0.8), // P(up) = 0.8, D = 0.2
          retail: makeR2('retail', 'down', 0.8), // P(up) = 0.2, D = 0.8
        };

        const result = selectDevilsAdvocate(r2Signals);
        expect(result.majorityDirection).toBe('up');
        expect(result.devilsAdvocate).toBe('retail');
      });

      it('breaks tie between fii and dii in favor of fii', () => {
        const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
          price: makeR2('price', 'up', 0.9), // P(up) = 0.9, D = 0.1
          fii: makeR2('fii', 'down', 0.7), // P(up) = 0.3, D = 0.7
          dii: makeR2('dii', 'down', 0.7), // P(up) = 0.3, D = 0.7
          retail: makeR2('retail', 'up', 0.8), // P(up) = 0.8, D = 0.2
        };

        const result = selectDevilsAdvocate(r2Signals);
        expect(result.majorityDirection).toBe('up');
        expect(result.devilsAdvocate).toBe('fii');
      });

      it('breaks tie between dii and price in favor of dii', () => {
        const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
          price: makeR2('price', 'down', 0.75), // P(up) = 0.25, D = 0.75
          fii: makeR2('fii', 'up', 0.8), // P(up) = 0.80, D = 0.20
          dii: makeR2('dii', 'down', 0.75), // P(up) = 0.25, D = 0.75
          retail: makeR2('retail', 'up', 0.8), // P(up) = 0.80, D = 0.20
        };

        const result = selectDevilsAdvocate(r2Signals);
        expect(result.majorityDirection).toBe('up');
        expect(result.devilsAdvocate).toBe('dii');
      });

      it('breaks 4-way tie in favor of retail', () => {
        const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
          price: makeR2('price', 'up', 0.7),
          fii: makeR2('fii', 'up', 0.7),
          dii: makeR2('dii', 'up', 0.7),
          retail: makeR2('retail', 'up', 0.7),
        };

        const result = selectDevilsAdvocate(r2Signals);
        expect(result.majorityDirection).toBe('up');
        expect(result.devilsAdvocate).toBe('retail');
      });
    });

    it('respects custom participant weights when provided', () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'up', 0.9), // P(up) = 0.9
        fii: makeR2('fii', 'down', 0.9), // P(up) = 0.1
        dii: makeR2('dii', 'down', 0.9), // P(up) = 0.1
        retail: makeR2('retail', 'down', 0.9), // P(up) = 0.1
      };

      // Heavy weight on price shifts majority to 'up'
      const weights = { price: 0.7, fii: 0.1, dii: 0.1, retail: 0.1 };
      // P(up) = 0.7 * 0.9 + 0.1 * 0.1 + 0.1 * 0.1 + 0.1 * 0.1 = 0.63 + 0.03 = 0.66 -> 'up'
      const result = selectDevilsAdvocate(r2Signals, weights);
      expect(result.majorityDirection).toBe('up');
      expect(result.avgPUp).toBeCloseTo(0.66, 4);
      // Opposed agents: fii, dii, retail all have D = 0.9 -> priority chooses retail
      expect(result.devilsAdvocate).toBe('retail');
    });

    it('halves weight of degraded agents in default calculation', () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'up', 0.9, 0.8, false), // w = 0.25, P(up) = 0.9
        fii: makeR2('fii', 'down', 0.9, 0.8, true), // w = 0.125, P(up) = 0.1
        dii: makeR2('dii', 'down', 0.9, 0.8, true), // w = 0.125, P(up) = 0.1
        retail: makeR2('retail', 'down', 0.9, 0.8, true), // w = 0.125, P(up) = 0.1
      };

      // total w = 0.25 + 0.375 = 0.625
      // normalized weights: price = 0.25/0.625 = 0.40, others = 0.125/0.625 = 0.20
      // P(up) = 0.40 * 0.9 + 3 * (0.20 * 0.1) = 0.36 + 0.06 = 0.42 -> majority 'down'
      const result = selectDevilsAdvocate(r2Signals);
      expect(result.majorityDirection).toBe('down');
      expect(result.avgPUp).toBeCloseTo(0.42, 4);
      // D_price = 0.9 (since majority down, D_i = P(up)_i)
      // D_fii = 0.1, D_dii = 0.1, D_retail = 0.1
      expect(result.devilsAdvocate).toBe('price');
    });
  });

  describe('2. Prompt Template Rendering', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const fiiConfig = AGENT_CONFIGS.find((c) => c.name === 'fii')!;

    it('renders Round 2 prompt with all 4 peer signals and evidence', () => {
      const r1Signals: Record<ParticipantAgentName, AgentSignal> = {
        price: makeR1('price', 'up', 0.75, 0.8),
        fii: makeR1('fii', 'down', 0.65, 0.7),
        dii: makeR1('dii', 'up', 0.7, 0.75),
        retail: makeR1('retail', 'up', 0.6, 0.65),
      };

      const prompt = renderRound2Prompt({
        config: priceConfig,
        symbol: 'TCS.NS',
        as_of: '2026-08-17',
        round1_signal: r1Signals.price,
        peer_signals: r1Signals,
      });

      expect(prompt).toContain('Price Action & Macro Anchor');
      expect(prompt).toContain('agent_name: "price"');
      expect(prompt).toContain('TCS.NS');
      expect(prompt).toContain('2026-08-17');
      expect(prompt).toContain('initial forecast of UP');
      expect(prompt).toContain('probability: 0.75');
      expect(prompt).toContain('[FII]: Direction=DOWN');
      expect(prompt).toContain('[DII]: Direction=UP');
      expect(prompt).toContain('[RETAIL]: Direction=UP');
      expect(prompt).toContain('EMA Golden Cross');
      expect(prompt).toContain('YOUR ROUND 2 CROSS-EXAMINATION MANDATE');
      expect(prompt).toContain('Round2Signal tool');
    });

    it("renders Round 3 prompt with Hard Devil's Advocate mandate when is_devils_advocate=true", () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'up', 0.8),
        fii: makeR2('fii', 'down', 0.75),
        dii: makeR2('dii', 'up', 0.7),
        retail: makeR2('retail', 'up', 0.65),
      };

      const prompt = renderRound3Prompt({
        config: fiiConfig,
        symbol: 'TCS.NS',
        as_of: '2026-08-17',
        majority_direction: 'up',
        avg_p_up: 0.73,
        peer_r2_signals: r2Signals,
        is_devils_advocate: true,
      });

      expect(prompt).toContain('Foreign Institutional Investor (FII) Intent');
      expect(prompt).toContain('leaning UP');
      expect(prompt).toContain('P(up) = 0.73');
      expect(prompt).toContain("CRITICAL MANDATE — HARD DEVIL'S ADVOCATE ASSIGNMENT");
      expect(prompt).toContain("You have been designated as the primary Devil's Advocate");
      expect(prompt).toContain('You MUST aggressively challenge and stress-test the UP thesis');
      expect(prompt).toContain('`is_devils_advocate`: true');
      expect(prompt).toContain('Round3Signal tool');
    });

    it('renders standard Round 3 mandate when is_devils_advocate=false', () => {
      const r2Signals: Record<ParticipantAgentName, Round2Signal> = {
        price: makeR2('price', 'up', 0.8),
        fii: makeR2('fii', 'down', 0.75),
        dii: makeR2('dii', 'up', 0.7),
        retail: makeR2('retail', 'up', 0.65),
      };

      const prompt = renderRound3Prompt({
        config: priceConfig,
        symbol: 'TCS.NS',
        as_of: '2026-08-17',
        majority_direction: 'up',
        avg_p_up: 0.73,
        peer_r2_signals: r2Signals,
        is_devils_advocate: false,
      });

      expect(prompt).toContain('Price Action & Macro Anchor');
      expect(prompt).toContain('ROUND 3 MANDATE:');
      expect(prompt).not.toContain("CRITICAL MANDATE — HARD DEVIL'S ADVOCATE ASSIGNMENT");
      expect(prompt).toContain('`is_devils_advocate`: false');
      expect(prompt).toContain('Round3Signal tool');
    });
  });

  describe('3. 4-Round Orchestration State Machine (runDebate)', () => {
    it('executes full 4 rounds transitioning R1 -> R2 -> R3 -> R4 Consensus', async () => {
      const invokedTurns: Array<{ agentName: ParticipantAgentName; round: number; isDevilsAdvocate?: boolean }> = [];

      const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
        invokedTurns.push({ agentName, round, isDevilsAdvocate });
        if (round === 1) {
          return makeR1(agentName, agentName === 'fii' ? 'down' : 'up', 0.8);
        } else if (round === 2) {
          return makeR2(agentName, agentName === 'fii' ? 'down' : 'up', 0.8);
        } else {
          return makeR3(agentName, agentName === 'fii' ? 'down' : 'up', 0.8, 0.85, isDevilsAdvocate);
        }
      });

      const consensus = await runDebate({
        symbol: 'TCS.NS',
        asOf: '2026-08-17T10:00:00.000Z',
        invoker: mockInvoker,
      });

      // 4 agents in R1 + 4 agents in R2 + 4 agents in R3 = 12 agent turns
      expect(mockInvoker).toHaveBeenCalledTimes(12);
      expect(invokedTurns.filter((t) => t.round === 1)).toHaveLength(4);
      expect(invokedTurns.filter((t) => t.round === 2)).toHaveLength(4);
      expect(invokedTurns.filter((t) => t.round === 3)).toHaveLength(4);

      // FII was the only agent opposed to UP majority (P(up)=0.2 vs others 0.8), so FII must be DA
      const r3Fii = invokedTurns.find((t) => t.round === 3 && t.agentName === 'fii');
      expect(r3Fii?.isDevilsAdvocate).toBe(true);

      const r3Price = invokedTurns.find((t) => t.round === 3 && t.agentName === 'price');
      expect(r3Price?.isDevilsAdvocate).toBe(false);

      expect(consensus.symbol).toBe('TCS.NS');
      expect(consensus.direction).toBe('up');
      expect(DebateConsensusSchema.parse(consensus)).toEqual(consensus);
    });

    it('works with pre-supplied Round 1 signals without re-running Round 1', async () => {
      const r1Signals: Record<ParticipantAgentName, AgentSignal> = {
        price: makeR1('price', 'up', 0.75),
        fii: makeR1('fii', 'down', 0.7),
        dii: makeR1('dii', 'up', 0.7),
        retail: makeR1('retail', 'up', 0.65),
      };

      const invokedTurns: Array<{ agentName: ParticipantAgentName; round: number }> = [];

      const mockInvoker = vi.fn(async ({ agentName, round, isDevilsAdvocate }) => {
        invokedTurns.push({ agentName, round });
        if (round === 2) {
          return makeR2(agentName, agentName === 'fii' ? 'down' : 'up', 0.75);
        } else {
          return makeR3(agentName, agentName === 'fii' ? 'down' : 'up', 0.75, 0.8, isDevilsAdvocate);
        }
      });

      const consensus = await runDebate({
        symbol: 'INFY.NS',
        asOf: '2026-08-17T10:00:00.000Z',
        round1Signals: r1Signals,
        invoker: mockInvoker,
      });

      // Only R2 (4) + R3 (4) = 8 turns
      expect(mockInvoker).toHaveBeenCalledTimes(8);
      expect(invokedTurns.filter((t) => t.round === 1)).toHaveLength(0);
      expect(consensus.signals_by_round.round1).toEqual(r1Signals);
    });

    it('persists all 1-3 round signals and Round 4 consensus record when store is provided', async () => {
      const savedRecords: DebateRoundRecord[] = [];
      const mockStore = {
        saveDebateRound: vi.fn(async (record: DebateRoundRecord) => {
          savedRecords.push(record);
        }),
      };

      const r1 = { price: makeR1('price'), fii: makeR1('fii'), dii: makeR1('dii'), retail: makeR1('retail') };
      const r2 = { price: makeR2('price'), fii: makeR2('fii'), dii: makeR2('dii'), retail: makeR2('retail') };
      const r3 = { price: makeR3('price'), fii: makeR3('fii'), dii: makeR3('dii'), retail: makeR3('retail') };

      const consensus = await runDebate({
        symbol: 'RELIANCE.NS',
        asOf: '2026-08-17T12:00:00.000Z',
        forecastId: '11111111-1111-1111-1111-111111111111',
        round1Signals: r1,
        round2Signals: r2,
        round3Signals: r3,
        store: mockStore,
      });

      expect(mockStore.saveDebateRound).toHaveBeenCalledTimes(13);
      expect(savedRecords.filter((r) => r.roundNumber === 1)).toHaveLength(4);
      expect(savedRecords.filter((r) => r.roundNumber === 2)).toHaveLength(4);
      expect(savedRecords.filter((r) => r.roundNumber === 3)).toHaveLength(4);

      const r4 = savedRecords.find((r) => r.roundNumber === 4);
      expect(r4).toBeDefined();
      expect(r4?.agentName).toBe('consensus');
      expect(r4?.forecastId).toBe('11111111-1111-1111-1111-111111111111');
      expect(r4?.symbol).toBe('RELIANCE.NS');
      expect(r4?.direction).toBe(consensus.direction);
      expect(r4?.probability).toBe(consensus.consensus_probability);
      expect(r4?.confidence).toBe(consensus.consensus_confidence);
    });

    it('can be instantiated as DebateOrchestrator class', async () => {
      const orchestrator = new DebateOrchestrator();
      expect(orchestrator).toBeInstanceOf(DebateOrchestrator);
      expect(typeof orchestrator.selectDevilsAdvocate).toBe('function');
      expect(typeof orchestrator.runDebate).toBe('function');

      const r2 = { price: makeR2('price'), fii: makeR2('fii'), dii: makeR2('dii'), retail: makeR2('retail') };
      const da = orchestrator.selectDevilsAdvocate(r2);
      expect(da.devilsAdvocate).toBe('retail');
    });
  });
});
