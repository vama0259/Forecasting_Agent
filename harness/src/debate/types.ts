import { z } from 'zod';
import { AgentSignalSchema, CapabilitySchema } from '../agents/schema.js';

export const AgentCritiqueItemSchema = z
  .object({
    target_agent: z.enum(['price', 'fii', 'dii', 'retail']),
    agreement_level: z.enum(['agree', 'partially_agree', 'disagree', 'strongly_oppose']),
    critique_point: z.string().min(1),
    counter_evidence_capability: CapabilitySchema.optional(),
  })
  .strict();

export type AgentCritiqueItem = z.infer<typeof AgentCritiqueItemSchema>;

export const Round2SignalSchema = AgentSignalSchema.extend({
  round: z.literal(2),
  critiques: z.array(AgentCritiqueItemSchema).min(1),
  probability_delta: z.number().min(-1).max(1),
}).strict();

export type Round2Signal = z.infer<typeof Round2SignalSchema>;

export const Round3SignalSchema = AgentSignalSchema.extend({
  round: z.literal(3),
  is_devils_advocate: z.boolean(),
  catastrophic_risks: z.array(z.string()).min(1),
  invalidation_triggers: z.array(z.string()).min(1),
}).strict();

export type Round3Signal = z.infer<typeof Round3SignalSchema>;

export const ScenarioDetailSchema = z
  .object({
    primary_advocate: z.enum(['price', 'fii', 'dii', 'retail']),
    direction: z.enum(['up', 'down']),
    probability: z.number().min(0.5, 'Scenario probability must be >= 0.50').max(1),
    confidence: z.number().min(0).max(1),
    primary_evidence_claims: z.array(z.string()).min(1),
    catastrophic_risks: z.array(z.string()).min(1),
    invalidation_triggers: z.array(z.string()).min(1),
    dissent: z.string().optional(),
  })
  .strict();

export type ScenarioDetail = z.infer<typeof ScenarioDetailSchema>;

export const ScenarioSynthesisSchema = z
  .object({
    bull_case: ScenarioDetailSchema,
    bear_case: ScenarioDetailSchema,
  })
  .strict();

export type ScenarioSynthesis = z.infer<typeof ScenarioSynthesisSchema>;

export const ParticipantWeightsSchema = z
  .object({
    price: z.number().min(0).max(1),
    fii: z.number().min(0).max(1),
    dii: z.number().min(0).max(1),
    retail: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => Math.abs(w.price + w.fii + w.dii + w.retail - 1.0) < 0.001, {
    message: 'Normalized participant weights must sum to 1.0',
  });

export type ParticipantWeights = z.infer<typeof ParticipantWeightsSchema>;

export const SignalsByRoundSchema = z
  .object({
    round1: z
      .object({
        price: AgentSignalSchema,
        fii: AgentSignalSchema,
        dii: AgentSignalSchema,
        retail: AgentSignalSchema,
      })
      .strict(),
    round2: z
      .object({
        price: Round2SignalSchema,
        fii: Round2SignalSchema,
        dii: Round2SignalSchema,
        retail: Round2SignalSchema,
      })
      .strict(),
    round3: z
      .object({
        price: Round3SignalSchema,
        fii: Round3SignalSchema,
        dii: Round3SignalSchema,
        retail: Round3SignalSchema,
      })
      .strict(),
  })
  .strict();

export type SignalsByRound = z.infer<typeof SignalsByRoundSchema>;

export const DebateConsensusSchema = z
  .object({
    symbol: z.string().min(1),
    as_of: z.string().datetime(),
    direction: z.enum(['up', 'down']),
    consensus_probability: z.number().min(0.5, 'Consensus probability must be >= 0.50').max(1),
    consensus_confidence: z.number().min(0).max(1),
    dispersion: z.number().min(0),
    is_deadlocked: z.boolean(),
    weights: ParticipantWeightsSchema,
    signals_by_round: SignalsByRoundSchema,
    scenarios: ScenarioSynthesisSchema.optional(),
  })
  .strict();

export type DebateConsensus = z.infer<typeof DebateConsensusSchema>;
