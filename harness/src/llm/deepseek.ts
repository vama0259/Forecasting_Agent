import { ChatOpenAI } from '@langchain/openai';
import { createMiddleware } from 'langchain';
import type { HarnessConfig } from '../config.js';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const deepSeekAutoToolChoiceMiddleware = createMiddleware({
  name: 'DeepSeekThinkingAutoToolChoice',
  wrapModelCall: (request, handler) => handler({ ...request, toolChoice: 'auto' }),
});

export function buildDeepSeekModel(llmConfig: HarnessConfig['llm']): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
    configuration: {
      baseURL: llmConfig.base_url ?? DEEPSEEK_BASE_URL,
    },
  });
}
