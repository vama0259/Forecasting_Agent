import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import type { StructuredTool } from '@langchain/core/tools';
import { buildModel } from '../llm/index.js';
import { buildCostBudgetMiddleware } from '../middleware/cost-budget.js';
import { buildEvidenceValidationMiddleware } from '../middleware/evidence-validation.js';
import { buildAuditMiddleware } from '../middleware/audit.js';
import { AgentSignalSchema } from './schema.js';
import type { ParticipantAgentConfig } from './types.js';
import type { HarnessConfig } from '../config.js';
import type { CompositeBackend } from 'deepagents';
import type { TraceHandle } from '../tracing/langfuse.js';

import type { z } from 'zod';

export interface BuildParticipantAgentParams {
  config: ParticipantAgentConfig;
  llmConfig: HarnessConfig['llm'];
  tools: StructuredTool[];
  backend: CompositeBackend;
  trace?: TraceHandle | undefined;
  schema?: z.ZodTypeAny | undefined;
}

// Wraps a sentiment StructuredTool to ensure any runtime failure returns a degraded neutral fallback.
export function wrapSentimentTool(tool: StructuredTool): StructuredTool {
  const originalInvoke = tool.invoke.bind(tool);
  return new Proxy(tool, {
    get(target, prop, receiver) {
      if (prop === 'invoke') {
        return async (input: unknown, config?: Parameters<StructuredTool['invoke']>[1]) => {
          try {
            return await originalInvoke(input, config);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
              score: 0.0,
              label: 'neutral',
              confidence: 0.0,
              degraded: true,
              reason,
            };
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function buildParticipantAgent({
  config,
  llmConfig,
  tools,
  backend,
  trace,
  schema,
}: BuildParticipantAgentParams) {
  const filteredTools = tools
    .filter((t) => config.tools.includes(t.name))
    .map((t) => (t.name === 'score_sentiment' ? wrapSentimentTool(t) : t));
  const { model, middlewares: providerMiddlewares } = buildModel(llmConfig);

  return createDeepAgent({
    model,
    tools: filteredTools,
    backend,
    responseFormat: toolStrategy(schema ?? AgentSignalSchema),
    middleware: [
      ...providerMiddlewares,
      buildCostBudgetMiddleware(config.maxTokenBudget),
      buildEvidenceValidationMiddleware(config.name, config.allowedCapabilities, config.primaryCapability),
      buildAuditMiddleware(config.name, trace),
    ],
  });
}
