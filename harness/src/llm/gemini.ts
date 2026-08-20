import { ChatOpenAI } from '@langchain/openai';
import type { HarnessConfig } from '../config.js';
import type { ModelWithMiddlewares } from './types.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

/**
 * Builds a ChatOpenAI model instance configured for Google Gemini.
 * Gemini natively supports structured tool outputs and reasoning budgets without
 * requiring DeepSeek's thinking-mode tool_choice workaround.
 */
export function buildGeminiModel(llmConfig: HarnessConfig['llm']): ModelWithMiddlewares {
  const model = new ChatOpenAI({
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : { temperature: 0.2 }),
    configuration: {
      baseURL: llmConfig.base_url ?? GEMINI_BASE_URL,
    },
  });

  return {
    model,
    middlewares: [],
  };
}
