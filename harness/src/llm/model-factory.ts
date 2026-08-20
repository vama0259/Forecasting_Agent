import type { HarnessConfig } from '../config.js';
import type { ModelWithMiddlewares } from './types.js';
import { buildGeminiModel } from './gemini.js';
import { buildDeepSeekModel, deepSeekAutoToolChoiceMiddleware } from './deepseek.js';
import { buildGrokModel } from './grok.js';
import { buildOpenAIModel } from './openai.js';

/**
 * Universal model factory for the Forecasting Agent harness.
 * Resolves the configured LLM provider (gemini, deepseek, grok, openai) and attaches
 * any required provider-level middlewares (e.g. DeepSeek thinking-mode auto tool choice).
 */
export function buildModel(llmConfig: HarnessConfig['llm']): ModelWithMiddlewares {
  const provider = llmConfig.provider.toLowerCase().trim();

  switch (provider) {
    case 'gemini':
    case 'google':
      return buildGeminiModel(llmConfig);

    case 'deepseek':
      return {
        model: buildDeepSeekModel(llmConfig),
        middlewares: [deepSeekAutoToolChoiceMiddleware],
      };

    case 'grok':
    case 'xai':
      return buildGrokModel(llmConfig);

    case 'openai':
      return buildOpenAIModel(llmConfig);

    default:
      if (llmConfig.base_url) {
        return buildOpenAIModel(llmConfig);
      }
      throw new Error(
        `Unsupported LLM provider: '${llmConfig.provider}'. Supported providers: gemini, deepseek, grok, openai.`,
      );
  }
}
