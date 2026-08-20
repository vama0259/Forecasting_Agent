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

export function buildParticipantAgent({
  config,
  llmConfig,
  tools,
  backend,
  trace,
  schema,
}: BuildParticipantAgentParams) {
  const filteredTools = tools.filter((t) => config.tools.includes(t.name));
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
