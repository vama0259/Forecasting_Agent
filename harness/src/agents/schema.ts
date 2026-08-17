import { z } from 'zod';

export const EvidenceItemSchema = z.object({
  claim: z.string().min(1, 'Evidence claim cannot be empty'),
  source_capability: z.string().min(1, 'source_capability is required for auditability'),
  value: z.unknown(),
  explicit_absence: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AgentSignalSchema = z.object({
  agent_name: z.enum(['price', 'fii', 'dii', 'retail']),
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0.0).max(1.0),
  confidence: z.number().min(0.0).max(1.0),
  horizon_days: z.literal(1),
  evidence: z.array(EvidenceItemSchema).min(1, 'At least one evidence item is required'),
  dissent: z.string().optional(),
  degraded: z.boolean().default(false),
});

export type AgentSignal = z.infer<typeof AgentSignalSchema>;
