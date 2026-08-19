import { z } from 'zod';

export const CapabilitySchema = z.enum(['market_data', 'flows', 'macro', 'microstructure', 'sentiment']);

export type Capability = z.infer<typeof CapabilitySchema>;

export const EvidenceItemSchema = z.object({
  claim: z.string().min(1, 'Evidence claim cannot be empty'),
  source_capability: CapabilitySchema,
  value: z.unknown(),
  explicit_absence: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AgentSignalSchema = z.object({
  agent_name: z.enum(['price', 'fii', 'dii', 'retail']),
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0.5, 'Probability for chosen direction must be >= 0.50').max(1.0),
  confidence: z.number().min(0.0).max(1.0),
  horizon_days: z.literal(1),
  evidence: z.array(EvidenceItemSchema).min(1, 'At least one evidence item is required'),
  dissent: z.string().optional(),
  degraded: z.boolean().default(false),
});

export type AgentSignal = z.infer<typeof AgentSignalSchema>;
