// The price-anchor deepagents config: DeepSeek model + market-data tools + Docker sandbox backend per ADR-002/023/014.

import { createDeepAgent } from 'deepagents';
import type { StructuredTool } from '@langchain/core/tools';
import { ChatDeepSeek } from '@langchain/deepseek';
import type { HarnessConfig } from '../config.js';
import type { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';

// Parameters for building the price-anchor deep agent instance.
export interface BuildPriceAnchorAgentParams {
  llmConfig: HarnessConfig['llm'];
  tools: StructuredTool[];
  backend: SandboxBackendAdapter;
}

// Takes the LLM config, MCP tools, and a sandbox backend; returns a configured deepagents instance.
export function buildPriceAnchorAgent({ llmConfig, tools, backend }: BuildPriceAnchorAgentParams) {
  const model = new ChatDeepSeek({ apiKey: llmConfig.api_key, model: llmConfig.model });
  return createDeepAgent({ model, tools, backend });
}
