import { ChatOpenAI } from '@langchain/openai';
import type { HarnessConfig } from '../config.js';
import type { ModelWithMiddlewares } from './types.js';

export function buildOpenAIModel(llmConfig: HarnessConfig['llm']): ModelWithMiddlewares {
  const model = new ChatOpenAI({
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
    ...(llmConfig.base_url ? { configuration: { baseURL: llmConfig.base_url } } : {}),
  });

  return {
    model,
    middlewares: [],
  };
}
