import { createMiddleware } from 'langchain';
import type { AgentSignal } from '../agents/schema.js';

export function buildEvidenceValidationMiddleware(agentName: string, allowedCapabilities: string[]) {
  return createMiddleware({
    name: 'EvidenceValidationMiddleware',
    afterModel: async (state: { structuredResponse?: Record<string, unknown> }) => {
      if (!state.structuredResponse) return state;
      const signal = state.structuredResponse as Partial<AgentSignal>;
      if (Array.isArray(signal.evidence)) {
        let hasViolation = false;
        for (const item of signal.evidence) {
          if (!allowedCapabilities.includes(item.source_capability)) {
            console.warn(
              `[${agentName}] Evidence source_capability '${item.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`,
            );
            hasViolation = true;
          }
        }
        if (hasViolation) {
          signal.degraded = true;
        }
      }
      return state;
    },
  });
}
