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

export const AgentSignalSchema = z
  .object({
    agent_name: z.enum(['price', 'fii', 'dii', 'retail']),
    direction: z.enum(['up', 'down']),
    probability: z.number().min(0.5, 'Probability for chosen direction must be >= 0.50').max(1.0),
    confidence: z.number().min(0.0).max(1.0),
    horizon_days: z.literal(1),
    evidence: z.array(EvidenceItemSchema).min(1, 'At least one evidence item is required'),
    dissent: z.string().optional(),
    degraded: z.boolean().default(false),
    // Required whenever degraded is true -- states plainly what capability was missing and what
    // the signal is based on instead, so degradation is a visible statement, not a hidden weight.
    degraded_reason: z.string().min(1).optional(),
  })
  .refine((s) => !s.degraded || !!s.degraded_reason, {
    message: 'degraded_reason is required whenever degraded is true',
    path: ['degraded_reason'],
  });

export type AgentSignal = z.infer<typeof AgentSignalSchema>;
