import { createMiddleware } from 'langchain';
import type { TraceHandle } from '../tracing/langfuse.js';

export function buildAuditMiddleware(agentName: string, trace?: TraceHandle) {
  return createMiddleware({
    name: 'AuditMiddleware',
    wrapModelCall: async (request, handler) => {
      const start = Date.now();
      try {
        return await handler(request);
      } finally {
        const durationMs = Date.now() - start;
        trace?.update({
          metadata: {
            [`${agentName}_last_model_duration_ms`]: durationMs,
          },
        });
      }
    },
    wrapToolCall: async (request, handler) => {
      const start = Date.now();
      try {
        return await handler(request);
      } finally {
        const durationMs = Date.now() - start;
        trace?.update({
          metadata: {
            [`${agentName}_tool_${request.toolCall.name}_duration_ms`]: durationMs,
          },
        });
      }
    },
  });
}
