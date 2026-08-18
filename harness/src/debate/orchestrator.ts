import { randomUUID } from 'node:crypto';
import type { StructuredTool } from '@langchain/core/tools';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import type { HarnessConfig } from '../config.js';
import type { TraceHandle, getLangchainCallbackHandler } from '../tracing/langfuse.js';
import { AGENT_CONFIGS, type ParticipantAgentConfig } from '../agents/types.js';
import { AgentSignalSchema, type AgentSignal } from '../agents/schema.js';
import { buildParticipantAgent } from '../agents/factory.js';
import { buildAgentBackend } from '../backend/composite.js';
import { invokeAgentTurn } from '../pipeline/agent-turn.js';
import { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';
import { renderPrompt, renderRound2Prompt, renderRound3Prompt } from '../prompts/engine.js';
import {
  type DebateConsensus,
  type SignalsByRound,
  type Round2Signal,
  type Round3Signal,
  type ParticipantWeights,
  Round2SignalSchema,
  Round3SignalSchema,
} from './types.js';
import { calculateConsensus, normalizeToPUp, PARTICIPANTS, type Participant } from './consensus.js';
import type { DebateRoundRecord } from '../storage/postgres-store.js';

export type ParticipantAgentName = Participant;

export interface SelectDevilsAdvocateResult {
  devilsAdvocate: ParticipantAgentName;
  majorityDirection: 'up' | 'down';
  avgPUp: number;
}

export type AgentTurnInvoker = (params: {
  agentName: ParticipantAgentName;
  round: 1 | 2 | 3;
  prompt: string;
  isDevilsAdvocate?: boolean;
}) => Promise<AgentSignal | Round2Signal | Round3Signal>;

export interface DebateStoreLike {
  saveDebateRound(record: DebateRoundRecord): Promise<void>;
}

export interface RunDebateParams {
  symbol: string;
  asOf?: string | Date | undefined;
  forecastId?: string | undefined;
  historicalBrier?: Partial<Record<ParticipantAgentName, number>> | undefined;
  weights?: ParticipantWeights | undefined;
  round1Signals?: Record<ParticipantAgentName, AgentSignal> | undefined;
  round2Signals?: Record<ParticipantAgentName, Round2Signal> | undefined;
  round3Signals?: Record<ParticipantAgentName, Round3Signal> | undefined;
  invoker?: AgentTurnInvoker | undefined;
  config?: HarnessConfig | undefined;
  tools?: StructuredTool[] | undefined;
  sandboxAdapter?: SandboxBackendAdapter | undefined;
  store?: BaseStore | DebateStoreLike | undefined;
  trace?: TraceHandle | undefined;
  langfuseHandler?: ReturnType<typeof getLangchainCallbackHandler> | undefined;
}

export { renderRound2Prompt, renderRound3Prompt };

/**
 * Weighted Devil's Advocate Selection Algorithm.
 *
 * 1. Calculates weighted provisional P(up)^(R2) = \sum \hat{w}_i P(up)_i^(R2).
 * 2. Majority = 'up' if P(up)^(R2) >= 0.50 else 'down'.
 * 3. Distance D_i = 1.0 - P(up)_i if Majority == 'up' else P(up)_i.
 * 4. DA = argmax D_i, ties broken by priority retail -> fii -> dii -> price.
 */
export function selectDevilsAdvocate(
  r2Signals: Record<ParticipantAgentName, Round2Signal>,
  weights?: ParticipantWeights,
): SelectDevilsAdvocateResult {
  const pUps: Record<ParticipantAgentName, number> = {
    price: normalizeToPUp(r2Signals.price.direction, r2Signals.price.probability),
    fii: normalizeToPUp(r2Signals.fii.direction, r2Signals.fii.probability),
    dii: normalizeToPUp(r2Signals.dii.direction, r2Signals.dii.probability),
    retail: normalizeToPUp(r2Signals.retail.direction, r2Signals.retail.probability),
  };

  let normalizedWeights: Record<ParticipantAgentName, number>;
  if (weights) {
    normalizedWeights = weights;
  } else {
    const rawW: Record<ParticipantAgentName, number> = {
      price: r2Signals.price.degraded ? 0.125 : 0.25,
      fii: r2Signals.fii.degraded ? 0.125 : 0.25,
      dii: r2Signals.dii.degraded ? 0.125 : 0.25,
      retail: r2Signals.retail.degraded ? 0.125 : 0.25,
    };
    const sumW = rawW.price + rawW.fii + rawW.dii + rawW.retail;
    normalizedWeights = {
      price: sumW > 1e-6 ? rawW.price / sumW : 0.25,
      fii: sumW > 1e-6 ? rawW.fii / sumW : 0.25,
      dii: sumW > 1e-6 ? rawW.dii / sumW : 0.25,
      retail: sumW > 1e-6 ? rawW.retail / sumW : 0.25,
    };
  }

  let avgPUp = 0;
  for (const p of PARTICIPANTS) {
    avgPUp += normalizedWeights[p] * pUps[p];
  }
  avgPUp = Math.max(0, Math.min(1, avgPUp));

  const majorityDirection: 'up' | 'down' = avgPUp >= 0.5 ? 'up' : 'down';

  const distances: Record<ParticipantAgentName, number> = {
    price: majorityDirection === 'up' ? 1.0 - pUps.price : pUps.price,
    fii: majorityDirection === 'up' ? 1.0 - pUps.fii : pUps.fii,
    dii: majorityDirection === 'up' ? 1.0 - pUps.dii : pUps.dii,
    retail: majorityDirection === 'up' ? 1.0 - pUps.retail : pUps.retail,
  };

  const PRIORITY: ParticipantAgentName[] = ['retail', 'fii', 'dii', 'price'];
  let maxD = -Infinity;
  for (const p of PARTICIPANTS) {
    if (distances[p] > maxD) {
      maxD = distances[p];
    }
  }

  let chosenDA: ParticipantAgentName = 'retail';
  for (const p of PRIORITY) {
    if (Math.abs(distances[p] - maxD) < 1e-6) {
      chosenDA = p;
      break;
    }
  }

  return {
    devilsAdvocate: chosenDA,
    majorityDirection,
    avgPUp,
  };
}

function getAgentConfig(agentName: ParticipantAgentName): ParticipantAgentConfig {
  const cfg = AGENT_CONFIGS.find((c) => c.name === agentName);
  if (!cfg) {
    throw new Error(`Configuration not found for agent '${agentName}'`);
  }
  return cfg;
}

function isDebateStore(store: unknown): store is DebateStoreLike {
  return typeof store === 'object' && store !== null && 'saveDebateRound' in store;
}

/**
 * 4-Round Adversarial Debate Orchestrator.
 * Coordinates R1 -> R2 -> R3 -> R4 Consensus execution and persistence.
 */
export async function runDebate(params: RunDebateParams): Promise<DebateConsensus> {
  const {
    symbol,
    asOf = new Date(),
    forecastId = randomUUID(),
    historicalBrier,
    weights,
    round1Signals: preR1,
    round2Signals: preR2,
    round3Signals: preR3,
    invoker,
    config,
    tools = [],
    sandboxAdapter,
    store,
    trace,
    langfuseHandler,
  } = params;

  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const asOfIso = asOfDate.toISOString();
  const asOfDateStr = asOfIso.slice(0, 10);

  // Helper to persist round
  const maybeSaveRound = async (record: DebateRoundRecord) => {
    if (isDebateStore(store)) {
      await store.saveDebateRound(record);
    }
  };

  const safeTools = (tools ?? []).map((t) => {
    (t as { handleToolErrors?: boolean }).handleToolErrors = true;
    return t;
  });

  function getFallbackR1Signal(name: ParticipantAgentName): AgentSignal {
    return {
      agent_name: name,
      direction: 'down',
      probability: 0.5,
      confidence: 0.2,
      horizon_days: 1,
      degraded: true,
      evidence: [
        {
          claim: 'Fallback signal due to degraded turn execution',
          source_capability: 'market_data',
          value: { status: 'fallback' },
          explicit_absence: true,
        },
      ],
    };
  }

  function getFallbackR2Signal(name: ParticipantAgentName): Round2Signal {
    return {
      agent_name: name,
      round: 2,
      direction: 'down',
      probability: 0.5,
      confidence: 0.2,
      horizon_days: 1,
      degraded: true,
      critiques: [
        {
          target_agent: 'price',
          agreement_level: 'partially_agree',
          critique_point: 'Fallback critique due to degraded turn execution',
        },
      ],
      probability_delta: 0,
      evidence: [
        {
          claim: 'Fallback signal due to degraded turn execution',
          source_capability: 'market_data',
          value: { status: 'fallback' },
          explicit_absence: true,
        },
      ],
    };
  }

  function getFallbackR3Signal(name: ParticipantAgentName): Round3Signal {
    return {
      agent_name: name,
      round: 3,
      direction: 'down',
      probability: 0.5,
      confidence: 0.2,
      horizon_days: 1,
      degraded: true,
      is_devils_advocate: false,
      catastrophic_risks: ['Fallback risk notice'],
      invalidation_triggers: ['Fallback invalidation trigger'],
      evidence: [
        {
          claim: 'Fallback signal due to degraded turn execution',
          source_capability: 'market_data',
          value: { status: 'fallback' },
          explicit_absence: true,
        },
      ],
    };
  }

  // ==========================================
  // ROUND 1: Initial Forecasts
  // ==========================================
  let round1Signals: Record<ParticipantAgentName, AgentSignal>;

  if (preR1) {
    round1Signals = {
      price: preR1.price || getFallbackR1Signal('price'),
      fii: preR1.fii || getFallbackR1Signal('fii'),
      dii: preR1.dii || getFallbackR1Signal('dii'),
      retail: preR1.retail || getFallbackR1Signal('retail'),
    };
  } else if (invoker) {
    const r1Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const prompt = renderPrompt(agentCfg, {
          symbol,
          as_of: asOfDateStr,
          horizon_days: 1,
        });
        const sig = (await invoker({ agentName: name, round: 1, prompt })) as AgentSignal;
        return [name, sig ? AgentSignalSchema.parse(sig) : getFallbackR1Signal(name)] as const;
      }),
    );
    round1Signals = Object.fromEntries(r1Entries) as Record<ParticipantAgentName, AgentSignal>;
  } else if (config && sandboxAdapter && store) {
    const r1Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const prompt = renderPrompt(agentCfg, {
          symbol,
          as_of: asOfDateStr,
          horizon_days: 1,
        });
        const backend = buildAgentBackend({
          sandboxAdapter,
          store: store as BaseStore,
          agentName: agentCfg.name,
        });
        const agent = buildParticipantAgent({
          config: agentCfg,
          llmConfig: config.llm,
          tools: safeTools,
          backend,
          trace,
          schema: AgentSignalSchema,
        });

        try {
          const sig = await invokeAgentTurn<AgentSignal>({
            invoke: (invokeCfg) =>
              agent.invoke(
                { messages: [{ role: 'user', content: prompt }] },
                { ...invokeCfg, ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}) },
              ),
            schema: AgentSignalSchema,
            trace: trace!,
            turnId: `r1-${name}-${symbol}`,
          });
          return [name, sig || getFallbackR1Signal(name)] as const;
        } catch (turnErr) {
          console.warn(
            `[WARN] R1 turn failed for ${name}: ${turnErr instanceof Error ? turnErr.message : String(turnErr)}`,
          );
          return [name, getFallbackR1Signal(name)] as const;
        }
      }),
    );
    round1Signals = Object.fromEntries(r1Entries) as Record<ParticipantAgentName, AgentSignal>;
  } else {
    throw new Error('Debate orchestration requires round1Signals, an invoker, or LLM config/tools/backend.');
  }

  // Guarantee all participants exist
  for (const name of PARTICIPANTS) {
    if (!round1Signals[name]) {
      round1Signals[name] = getFallbackR1Signal(name);
    }
  }

  // Persist Round 1 signals
  for (const name of PARTICIPANTS) {
    const sig = round1Signals[name];
    await maybeSaveRound({
      forecastId,
      symbol,
      asOf: asOfIso,
      roundNumber: 1,
      agentName: name,
      direction: sig.direction,
      probability: sig.probability,
      confidence: sig.confidence,
      degraded: sig.degraded,
      payload: sig as unknown as Record<string, unknown>,
    });
  }

  // ==========================================
  // ROUND 2: Cross-Examination & Peer Critique
  // ==========================================
  let round2Signals: Record<ParticipantAgentName, Round2Signal>;

  if (preR2) {
    round2Signals = {
      price: preR2.price || getFallbackR2Signal('price'),
      fii: preR2.fii || getFallbackR2Signal('fii'),
      dii: preR2.dii || getFallbackR2Signal('dii'),
      retail: preR2.retail || getFallbackR2Signal('retail'),
    };
  } else if (invoker) {
    const r2Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const prompt = renderRound2Prompt({
          config: agentCfg,
          symbol,
          as_of: asOfDateStr,
          round1_signal: round1Signals[name],
          peer_signals: round1Signals,
        });
        const sig = (await invoker({ agentName: name, round: 2, prompt })) as Round2Signal;
        return [name, sig ? Round2SignalSchema.parse(sig) : getFallbackR2Signal(name)] as const;
      }),
    );
    round2Signals = Object.fromEntries(r2Entries) as Record<ParticipantAgentName, Round2Signal>;
  } else if (config && sandboxAdapter && store) {
    const r2Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const prompt = renderRound2Prompt({
          config: agentCfg,
          symbol,
          as_of: asOfDateStr,
          round1_signal: round1Signals[name],
          peer_signals: round1Signals,
        });
        const backend = buildAgentBackend({
          sandboxAdapter,
          store: store as BaseStore,
          agentName: agentCfg.name,
        });
        const agent = buildParticipantAgent({
          config: agentCfg,
          llmConfig: config.llm,
          tools: safeTools,
          backend,
          trace,
          schema: Round2SignalSchema,
        });

        try {
          const sig = await invokeAgentTurn<Round2Signal>({
            invoke: (invokeCfg) =>
              agent.invoke(
                { messages: [{ role: 'user', content: prompt }] },
                { ...invokeCfg, ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}) },
              ),
            schema: Round2SignalSchema,
            trace: trace!,
            turnId: `r2-${name}-${symbol}`,
          });
          return [name, sig || getFallbackR2Signal(name)] as const;
        } catch (turnErr) {
          console.warn(
            `[WARN] R2 turn failed for ${name}: ${turnErr instanceof Error ? turnErr.message : String(turnErr)}`,
          );
          return [name, getFallbackR2Signal(name)] as const;
        }
      }),
    );
    round2Signals = Object.fromEntries(r2Entries) as Record<ParticipantAgentName, Round2Signal>;
  } else {
    throw new Error('Debate orchestration requires round2Signals, an invoker, or LLM config/tools/backend.');
  }

  // Guarantee all participants exist
  for (const name of PARTICIPANTS) {
    if (!round2Signals[name]) {
      round2Signals[name] = getFallbackR2Signal(name);
    }
  }

  // Persist Round 2 signals
  for (const name of PARTICIPANTS) {
    const sig = round2Signals[name];
    await maybeSaveRound({
      forecastId,
      symbol,
      asOf: asOfIso,
      roundNumber: 2,
      agentName: name,
      direction: sig.direction,
      probability: sig.probability,
      confidence: sig.confidence,
      degraded: sig.degraded,
      payload: sig as unknown as Record<string, unknown>,
    });
  }

  // ==========================================
  // DEVIL'S ADVOCATE SELECTION
  // ==========================================
  const daResult = selectDevilsAdvocate(round2Signals, weights);

  // ==========================================
  // ROUND 3: Hard Devil's Advocate Stress-Test
  // ==========================================
  let round3Signals: Record<ParticipantAgentName, Round3Signal>;

  if (preR3) {
    round3Signals = {
      price: preR3.price || getFallbackR3Signal('price'),
      fii: preR3.fii || getFallbackR3Signal('fii'),
      dii: preR3.dii || getFallbackR3Signal('dii'),
      retail: preR3.retail || getFallbackR3Signal('retail'),
    };
  } else if (invoker) {
    const r3Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const isDA = name === daResult.devilsAdvocate;
        const prompt = renderRound3Prompt({
          config: agentCfg,
          symbol,
          as_of: asOfDateStr,
          majority_direction: daResult.majorityDirection,
          avg_p_up: daResult.avgPUp,
          peer_r2_signals: round2Signals,
          is_devils_advocate: isDA,
        });
        const sig = (await invoker({
          agentName: name,
          round: 3,
          prompt,
          isDevilsAdvocate: isDA,
        })) as Round3Signal;
        return [name, sig ? Round3SignalSchema.parse(sig) : getFallbackR3Signal(name)] as const;
      }),
    );
    round3Signals = Object.fromEntries(r3Entries) as Record<ParticipantAgentName, Round3Signal>;
  } else if (config && sandboxAdapter && store) {
    const r3Entries = await Promise.all(
      PARTICIPANTS.map(async (name) => {
        const agentCfg = getAgentConfig(name);
        const isDA = name === daResult.devilsAdvocate;
        const prompt = renderRound3Prompt({
          config: agentCfg,
          symbol,
          as_of: asOfDateStr,
          majority_direction: daResult.majorityDirection,
          avg_p_up: daResult.avgPUp,
          peer_r2_signals: round2Signals,
          is_devils_advocate: isDA,
        });
        const backend = buildAgentBackend({
          sandboxAdapter,
          store: store as BaseStore,
          agentName: agentCfg.name,
        });
        const agent = buildParticipantAgent({
          config: agentCfg,
          llmConfig: config.llm,
          tools: safeTools,
          backend,
          trace,
          schema: Round3SignalSchema,
        });

        try {
          const sig = await invokeAgentTurn<Round3Signal>({
            invoke: (invokeCfg) =>
              agent.invoke(
                { messages: [{ role: 'user', content: prompt }] },
                { ...invokeCfg, ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}) },
              ),
            schema: Round3SignalSchema,
            trace: trace!,
            turnId: `r3-${name}-${symbol}`,
          });
          return [name, sig || getFallbackR3Signal(name)] as const;
        } catch (turnErr) {
          console.warn(
            `[WARN] R3 turn failed for ${name}: ${turnErr instanceof Error ? turnErr.message : String(turnErr)}`,
          );
          return [name, getFallbackR3Signal(name)] as const;
        }
      }),
    );
    round3Signals = Object.fromEntries(r3Entries) as Record<ParticipantAgentName, Round3Signal>;
  } else {
    throw new Error('Debate orchestration requires round3Signals, an invoker, or LLM config/tools/backend.');
  }

  // Guarantee all participants exist
  for (const name of PARTICIPANTS) {
    if (!round3Signals[name]) {
      round3Signals[name] = getFallbackR3Signal(name);
    }
  }

  // Persist Round 3 signals
  for (const name of PARTICIPANTS) {
    const sig = round3Signals[name];
    await maybeSaveRound({
      forecastId,
      symbol,
      asOf: asOfIso,
      roundNumber: 3,
      agentName: name,
      direction: sig.direction,
      probability: sig.probability,
      confidence: sig.confidence,
      degraded: sig.degraded,
      payload: sig as unknown as Record<string, unknown>,
    });
  }

  // ==========================================
  // ROUND 4: Deterministic Arithmetic Consensus
  // ==========================================
  const signalsByRound: SignalsByRound = {
    round1: round1Signals,
    round2: round2Signals,
    round3: round3Signals,
  };

  const consensus = calculateConsensus({
    symbol,
    asOf: asOfIso,
    signalsByRound,
    ...(historicalBrier !== undefined ? { historicalBrier } : {}),
  });

  // Persist Round 4 consensus record
  const anyDegraded = Object.values(round3Signals).some((s) => s.degraded);
  await maybeSaveRound({
    forecastId,
    symbol,
    asOf: asOfIso,
    roundNumber: 4,
    agentName: 'consensus',
    direction: consensus.direction,
    probability: consensus.consensus_probability,
    confidence: consensus.consensus_confidence,
    degraded: anyDegraded,
    payload: consensus as unknown as Record<string, unknown>,
  });

  return consensus;
}

export class DebateOrchestrator {
  selectDevilsAdvocate(
    r2Signals: Record<ParticipantAgentName, Round2Signal>,
    weights?: ParticipantWeights,
  ): SelectDevilsAdvocateResult {
    return selectDevilsAdvocate(r2Signals, weights);
  }

  async runDebate(params: RunDebateParams): Promise<DebateConsensus> {
    return runDebate(params);
  }
}
