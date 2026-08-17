import { createMiddleware } from 'langchain';
import type { AgentSignal, Capability } from '../agents/schema.js';

export function buildEvidenceValidationMiddleware(agentName: string, allowedCapabilities: Capability[]) {
  return createMiddleware({
    name: 'EvidenceValidationMiddleware',
    afterModel: async (state: { structuredResponse?: Record<string, unknown> }) => {
      if (!state.structuredResponse) return state;
      const signal = state.structuredResponse as Partial<AgentSignal>;
      if (Array.isArray(signal.evidence)) {
        let hasViolation = false;
        for (const item of signal.evidence) {
          if (!item || !allowedCapabilities.includes(item.source_capability as Capability)) {
            console.warn(
              `[${agentName}] Evidence source_capability '${item?.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`,
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
