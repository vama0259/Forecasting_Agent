// Shared DeepSeek model construction for every deepagents instance in the harness (ADR-009/014).
// Centralized so each participant agent (#10: price/FII/DII/retail) gets the thinking-mode fix
// once, from here, instead of re-deriving it per agent.

import { ChatOpenAI } from '@langchain/openai';
import { createMiddleware } from 'langchain';
import type { HarnessConfig } from '../config.js';

// DeepSeek's OpenAI-compatible endpoint. @langchain/deepseek wraps this same endpoint but
// exposes no way to control tool_choice per-request, which is required by the workaround below.
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// Verified live against the DeepSeek API (2026-08-15): thinking mode (on by default, and we want
// it kept on for forecast quality) 400s on any non-"auto" tool_choice ("Thinking mode does not
// support this tool_choice"). deepagents/toolStrategy() forces tool_choice to "any" on every
// model turn once a structured responseFormat is set, so every turn 400s. DeepSeek does not yet
// support response_format:"json_schema" either ("This response_format type is unavailable now"),
// so the provider-native structured-output strategy isn't an option. This middleware forces
// tool_choice back to "auto" so thinking mode stays on; the extraction tool call is then
// voluntary rather than forced, so every agent's prompt must keep telling the model explicitly
// to finish with its structured signal.
export const deepSeekAutoToolChoiceMiddleware = createMiddleware({
  name: 'DeepSeekThinkingAutoToolChoice',
  wrapModelCall: (request, handler) => handler({ ...request, toolChoice: 'auto' }),
});

// Takes the harness LLM config; returns a ChatOpenAI instance pointed at DeepSeek's
// OpenAI-compatible endpoint. Always pair with deepSeekAutoToolChoiceMiddleware when the agent
// uses toolStrategy()-based structured output, or thinking mode will 400 on every turn.
export function buildDeepSeekModel(llmConfig: HarnessConfig['llm']): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: llmConfig.api_key,
    model: llmConfig.model,
    configuration: { baseURL: DEEPSEEK_BASE_URL },
  });
}
