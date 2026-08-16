// Provider implementing search capability via MCP AnySearch tool invocation with timeout handling.

import type { StructuredTool } from '@langchain/core/tools';
import type { CapabilityProvider } from '../capabilities/types.js';
import type { AnySearchResultParser } from './parser.js';
import {
  SearchProviderError,
  SearchProviderTimeoutError,
  SearchResponseFormatError,
  type SearchResult,
} from './types.js';

// Dependencies required to construct and operate an AnySearchProvider instance.
export interface AnySearchProviderDeps {
  getTools: () => Promise<StructuredTool[]>;
  parser: AnySearchResultParser;
  maxResults: number;
  timeoutMs: number;
}

// Executes search queries against the AnySearch MCP server, isolating the search tool and handling timeouts.
export class AnySearchProvider implements CapabilityProvider {
  private readonly deps: AnySearchProviderDeps;

  constructor(deps: AnySearchProviderDeps) {
    this.deps = deps;
  }

  // Invokes the search MCP tool with the specified query and parses the markdown response into SearchResult items.
  async search(query: string): Promise<SearchResult[]> {
    let signal: AbortSignal | undefined;
    try {
      const tools = await this.deps.getTools();
      const searchTool = tools.find((t) => t.name === 'search');
      if (!searchTool) {
        throw new SearchProviderError('AnySearch tool "search" not found on MCP client');
      }

      signal = AbortSignal.timeout(this.deps.timeoutMs);
      const rawResult = await searchTool.invoke({ query, max_results: this.deps.maxResults }, { signal });

      let text = '';
      if (typeof rawResult === 'string') {
        text = rawResult;
      } else if (rawResult && typeof rawResult === 'object') {
        if ('content' in rawResult) {
          const content = (rawResult as { content: unknown }).content;
          if (Array.isArray(content)) {
            text = content
              .map((item) => (item && typeof item === 'object' && 'text' in item ? String(item.text) : ''))
              .join('\n');
          } else if (typeof content === 'string') {
            text = content;
          }
        } else if ('text' in rawResult && typeof (rawResult as { text: unknown }).text === 'string') {
          text = (rawResult as { text: string }).text;
        } else {
          text = JSON.stringify(rawResult);
        }
      }

      return this.deps.parser.parse(text);
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new SearchProviderTimeoutError(`AnySearch provider call timed out after ${this.deps.timeoutMs}ms`);
      }
      if (err instanceof SearchResponseFormatError || err instanceof SearchProviderError) {
        throw err;
      }
      throw new SearchProviderError('AnySearch provider call failed', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  // Verifies that the MCP search tool is discovered and available without consuming quota.
  async healthCheck(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new SearchProviderTimeoutError('Health check aborted');
    }
    const tools = await this.deps.getTools();
    const searchTool = tools.find((t) => t.name === 'search');
    if (!searchTool) {
      throw new SearchProviderError('AnySearch tool "search" not found on MCP client');
    }
  }

  // Closes the provider instance without destroying external MCP clients.
  async close(): Promise<void> {
    // MCP client lifecycle is managed by Registry.
  }
}
