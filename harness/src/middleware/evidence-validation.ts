import { createMiddleware } from 'langchain';
import type { AgentSignal, Capability } from '../agents/schema.js';

// Takes an agent name, its allowed capabilities, and (optionally) its primary capability -- the
// one that makes it distinct from a second price agent (flows for fii/dii, microstructure for
// retail). Returns middleware that forces degraded=true, with a stated degraded_reason, whenever
// evidence cites a disallowed capability OR the agent's own primary capability came back absent.
export function buildEvidenceValidationMiddleware(
  agentName: string,
  allowedCapabilities: Capability[],
  primaryCapability?: Capability,
) {
  return createMiddleware({
    name: 'EvidenceValidationMiddleware',
    afterModel: async (state: { structuredResponse?: Record<string, unknown> }) => {
      if (!state.structuredResponse) return state;
      const signal = state.structuredResponse as Partial<AgentSignal>;
      if (Array.isArray(signal.evidence)) {
        let hasViolation = false;
        let primaryCapabilityAbsent = false;
        for (const item of signal.evidence) {
          if (!item || !allowedCapabilities.includes(item.source_capability as Capability)) {
            console.warn(
              `[${agentName}] Evidence source_capability '${item?.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`,
            );
            hasViolation = true;
          } else if (
            primaryCapability &&
            item.source_capability === primaryCapability &&
            item.explicit_absence === true
          ) {
            primaryCapabilityAbsent = true;
          }
        }
        if (hasViolation) {
          signal.degraded = true;
          signal.degraded_reason ??= `Evidence cited a capability outside ${agentName}'s allowed set: ${allowedCapabilities.join(', ')}.`;
        }
        if (primaryCapabilityAbsent) {
          console.warn(
            `[${agentName}] Primary capability '${primaryCapability}' was absent for this date. Marking signal degraded.`,
          );
          signal.degraded = true;
          signal.degraded_reason ??= `Primary capability '${primaryCapability}' had no data for this date; this call relies on the remaining allowed capabilities only.`;
        }
      }
      return state;
    },
  });
}
