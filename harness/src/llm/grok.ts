import { ChatOpenAI } from '@langchain/openai';
import type { HarnessConfig } from '../config.js';
import type { ModelWithMiddlewares } from './types.js';

export const GROK_BASE_URL = 'https://api.x.ai/v1';

export function buildGrokModel(llmConfig: HarnessConfig['llm']): ModelWithMiddlewares {
  const model = new ChatOpenAI({
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
    configuration: {
      baseURL: llmConfig.base_url ?? GROK_BASE_URL,
    },
  });

  return {
    model,
    middlewares: [],
  };
}
