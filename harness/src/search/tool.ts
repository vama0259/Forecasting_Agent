// Factory function constructing the LangChain search tool closing over the current forecast run ID.

import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SearchCapability } from './types.js';

// Creates a StructuredTool named search_news that delegates query execution to the search capability for a run ID.
export function buildSearchTool(capability: SearchCapability, runId: string): StructuredTool {
  return tool(async ({ query }) => JSON.stringify(await capability.search(runId, query)), {
    name: 'search_news',
    description: 'Search recent Indian financial news. Returns results from approved financial portals only.',
    schema: z.object({
      query: z.string().min(1).describe('One search intent, in natural language.'),
    }),
  });
}
