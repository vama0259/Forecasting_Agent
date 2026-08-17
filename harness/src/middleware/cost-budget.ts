import { createMiddleware } from 'langchain';
import type { UsageMetadata } from '@langchain/core/messages';

export function buildCostBudgetMiddleware(maxTokens: number) {
  let accumulatedTokens = 0;
  return createMiddleware({
    name: 'CostBudgetMiddleware',
    wrapModelCall: async (request, handler) => {
      if (accumulatedTokens >= maxTokens) {
        throw new Error(`Token budget exceeded: consumed ${accumulatedTokens} of ${maxTokens} max allowed tokens`);
      }
      const response = await handler(request);
      const usage = (response as unknown as { usage_metadata?: UsageMetadata }).usage_metadata;
      if (usage?.total_tokens) {
        accumulatedTokens += usage.total_tokens;
      }
      return response;
    },
  });
}
