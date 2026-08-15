// The price-anchor deepagents config: DeepSeek model + market-data tools + Docker sandbox backend per ADR-002/023/014.

import { createDeepAgent } from 'deepagents';
import type { StructuredTool } from '@langchain/core/tools';
import { toolStrategy } from 'langchain';
import { z } from 'zod';
import { buildDeepSeekModel, deepSeekAutoToolChoiceMiddleware } from '../llm/deepseek.js';
import type { HarnessConfig } from '../config.js';
import type { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';

// ADR-023 wire-format signal shape, enforced by the model's structured-output tool call
// (deepagents' responseFormat) rather than parsed out of freeform text after the fact.
export const PriceAnchorSignalSchema = z.object({
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  horizon_days: z.number().int().positive(),
  evidence: z.array(z.unknown()),
  dissent: z.string().optional(),
});

export type PriceAnchorSignal = z.infer<typeof PriceAnchorSignalSchema>;

// Parameters for building the price-anchor deep agent instance.
export interface BuildPriceAnchorAgentParams {
  llmConfig: HarnessConfig['llm'];
  tools: StructuredTool[];
  backend: SandboxBackendAdapter;
}

// Takes the LLM config, MCP tools, and a sandbox backend; returns a configured deepagents instance.
export function buildPriceAnchorAgent({ llmConfig, tools, backend }: BuildPriceAnchorAgentParams) {
  return createDeepAgent({
    model: buildDeepSeekModel(llmConfig),
    tools,
    backend,
    responseFormat: toolStrategy(PriceAnchorSignalSchema),
    middleware: [deepSeekAutoToolChoiceMiddleware],
  });
}
