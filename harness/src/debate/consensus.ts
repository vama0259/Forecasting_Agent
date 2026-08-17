import {
  type DebateConsensus,
  type SignalsByRound,
  type Round3Signal,
  type ScenarioDetail,
  type ScenarioSynthesis,
  DebateConsensusSchema,
} from './types.js';

export type Participant = 'price' | 'fii' | 'dii' | 'retail';

export const PARTICIPANTS: readonly Participant[] = ['price', 'fii', 'dii', 'retail'] as const;

export interface CalculateConsensusParams {
  symbol: string;
  asOf: string; // ISO 8601 string
  signalsByRound: SignalsByRound;
  historicalBrier?: Partial<Record<Participant, number>> | undefined;
}

/**
 * Normalizes a directional forecast probability to canonical P(up).
 * If direction is 'up', P(up) = probability.
 * If direction is 'down', P(up) = 1.0 - probability.
 */
export function normalizeToPUp(direction: 'up' | 'down', probability: number): number {
  return direction === 'up' ? probability : 1.0 - probability;
}

/**
 * Extracts a ScenarioDetail from an agent's Round 3 signal.
 */
function extractScenarioDetail(participant: Participant, signal: Round3Signal): ScenarioDetail {
  const detail: ScenarioDetail = {
    primary_advocate: participant,
    direction: signal.direction,
    probability: signal.probability,
    confidence: signal.confidence,
    primary_evidence_claims: signal.evidence.map((e) => e.claim),
    catastrophic_risks: signal.catastrophic_risks,
    invalidation_triggers: signal.invalidation_triggers,
  };

  if (signal.dissent !== undefined) {
    detail.dissent = signal.dissent;
  }

  return detail;
}

/**
 * Calculates deterministic arithmetic consensus across multi-round agent signals.
 * Zero-LLM mathematical aggregation based on Brier weighting, degradation penalties,
 * dispersion calculation, and dual-scenario extraction on deadlock.
 */
export function calculateConsensus(params: CalculateConsensusParams): DebateConsensus {
  const { symbol, asOf, signalsByRound, historicalBrier } = params;
  const r3Signals = signalsByRound.round3;

  // 1. Calculate base weights (b_i)
  const baseWeights: Record<Participant, number> = {
    price: 0.25,
    fii: 0.25,
    dii: 0.25,
    retail: 0.25,
  };

  if (historicalBrier) {
    const rawWeights: Record<Participant, number> = {
      price: Math.max(0.001, 1.0 - (historicalBrier.price ?? 0.25)),
      fii: Math.max(0.001, 1.0 - (historicalBrier.fii ?? 0.25)),
      dii: Math.max(0.001, 1.0 - (historicalBrier.dii ?? 0.25)),
      retail: Math.max(0.001, 1.0 - (historicalBrier.retail ?? 0.25)),
    };

    const denom = rawWeights.price + rawWeights.fii + rawWeights.dii + rawWeights.retail;

    if (denom > 1e-6) {
      for (const p of PARTICIPANTS) {
        baseWeights[p] = rawWeights[p] / denom;
      }
    }
  }

  // 2. Apply degradation penalty
  // w_i = b_i * 0.5 if degraded, else b_i
  const w: Record<Participant, number> = {
    price: r3Signals.price.degraded ? baseWeights.price * 0.5 : baseWeights.price,
    fii: r3Signals.fii.degraded ? baseWeights.fii * 0.5 : baseWeights.fii,
    dii: r3Signals.dii.degraded ? baseWeights.dii * 0.5 : baseWeights.dii,
    retail: r3Signals.retail.degraded ? baseWeights.retail * 0.5 : baseWeights.retail,
  };

  const sumW = w.price + w.fii + w.dii + w.retail;
  const sumBase = baseWeights.price + baseWeights.fii + baseWeights.dii + baseWeights.retail;

  // Global health factor H in [0.5, 1.0]
  const healthFactor = sumBase > 1e-6 ? sumW / sumBase : 1.0;

  // Normalized weights \hat{w}_i
  const normalizedWeights: Record<Participant, number> = {
    price: sumW > 1e-6 ? w.price / sumW : 0.25,
    fii: sumW > 1e-6 ? w.fii / sumW : 0.25,
    dii: sumW > 1e-6 ? w.dii / sumW : 0.25,
    retail: sumW > 1e-6 ? w.retail / sumW : 0.25,
  };

  // 3. Probability & Confidence Aggregation
  const pUps: Record<Participant, number> = {
    price: normalizeToPUp(r3Signals.price.direction, r3Signals.price.probability),
    fii: normalizeToPUp(r3Signals.fii.direction, r3Signals.fii.probability),
    dii: normalizeToPUp(r3Signals.dii.direction, r3Signals.dii.probability),
    retail: normalizeToPUp(r3Signals.retail.direction, r3Signals.retail.probability),
  };

  let pUpConsensus = 0;
  let rawConfidenceConsensus = 0;

  for (const p of PARTICIPANTS) {
    pUpConsensus += normalizedWeights[p] * pUps[p];
    rawConfidenceConsensus += normalizedWeights[p] * r3Signals[p].confidence;
  }

  // Ensure pUpConsensus is clamped to [0, 1]
  pUpConsensus = Math.max(0, Math.min(1, pUpConsensus));

  const direction: 'up' | 'down' = pUpConsensus >= 0.5 ? 'up' : 'down';
  const consensusProbability = direction === 'up' ? pUpConsensus : 1.0 - pUpConsensus;

  const consensusConfidence = Math.max(0, Math.min(1, rawConfidenceConsensus * healthFactor));

  // 4. Dispersion (\sigma_debate) & Deadlock Rule
  let variance = 0;
  for (const p of PARTICIPANTS) {
    variance += normalizedWeights[p] * Math.pow(pUps[p] - pUpConsensus, 2);
  }
  const dispersion = Math.sqrt(Math.max(0, variance));

  const isDeadlocked = dispersion >= 0.18 || (pUpConsensus >= 0.46 && pUpConsensus <= 0.54);

  // 5. Deterministic Dual-Scenario Extraction
  let scenarios: ScenarioSynthesis | undefined;

  if (isDeadlocked) {
    let bullAdvocate: Participant = 'price';
    let maxPUp = pUps[bullAdvocate];

    let bearAdvocate: Participant = 'price';
    let minPUp = pUps[bearAdvocate];

    for (const p of PARTICIPANTS) {
      if (pUps[p] > maxPUp) {
        maxPUp = pUps[p];
        bullAdvocate = p;
      }
      if (pUps[p] < minPUp) {
        minPUp = pUps[p];
        bearAdvocate = p;
      }
    }

    scenarios = {
      bull_case: extractScenarioDetail(bullAdvocate, r3Signals[bullAdvocate]),
      bear_case: extractScenarioDetail(bearAdvocate, r3Signals[bearAdvocate]),
    };
  }

  const consensus: DebateConsensus = {
    symbol,
    as_of: asOf,
    direction,
    consensus_probability: consensusProbability,
    consensus_confidence: consensusConfidence,
    dispersion,
    is_deadlocked: isDeadlocked,
    weights: {
      price: normalizedWeights.price,
      fii: normalizedWeights.fii,
      dii: normalizedWeights.dii,
      retail: normalizedWeights.retail,
    },
    signals_by_round: signalsByRound,
    ...(scenarios ? { scenarios } : {}),
  };

  return DebateConsensusSchema.parse(consensus);
}
