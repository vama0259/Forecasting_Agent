// Tests for AnySearchProvider verifying MCP tool filtering, signal timeout handling, and health check.

import { describe, it, expect, vi } from 'vitest';
import { AnySearchProvider } from '../../src/search/provider.js';
import { AnySearchResultParser } from '../../src/search/parser.js';
import { SearchProviderError, SearchProviderTimeoutError, SearchResponseFormatError } from '../../src/search/types.js';
import type { StructuredTool } from '@langchain/core/tools';

function createMockTool(
  name: string,
  invokeFn: (args: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
): StructuredTool {
  return {
    name,
    description: `${name} tool`,
    invoke: invokeFn,
  } as unknown as StructuredTool;
}

describe('AnySearchProvider', () => {
  const parser = new AnySearchResultParser();

  it('selects and invokes only the search tool with query and max_results', async () => {
    const searchInvoke = vi
      .fn()
      .mockResolvedValue(
        '## Search Results (1 results, 1ms)\n\n### 1. Test\n- **URL**: https://www.moneycontrol.com/a\nbody\n',
      );
    const batchInvoke = vi.fn();
    const extractInvoke = vi.fn();
    const subDomainsInvoke = vi.fn();

    const provider = new AnySearchProvider({
      getTools: async () => [
        createMockTool('batch_search', batchInvoke),
        createMockTool('extract', extractInvoke),
        createMockTool('get_sub_domains', subDomainsInvoke),
        createMockTool('search', searchInvoke),
      ],
      parser,
      maxResults: 5,
      timeoutMs: 1000,
    });

    const results = await provider.search('test query');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Test');
    expect(searchInvoke).toHaveBeenCalledTimes(1);
    expect(searchInvoke).toHaveBeenCalledWith(
      { query: 'test query', max_results: 5 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(batchInvoke).not.toHaveBeenCalled();
    expect(extractInvoke).not.toHaveBeenCalled();
    expect(subDomainsInvoke).not.toHaveBeenCalled();
  });

  it('handles content array response format', async () => {
    const searchInvoke = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '## Search Results (1 results, 1ms)\n\n### 1. Content Array\n- **URL**: https://www.moneycontrol.com/ca\nbody\n',
        },
      ],
    });

    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('search', searchInvoke)],
      parser,
      maxResults: 10,
      timeoutMs: 1000,
    });

    const results = await provider.search('query');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Content Array');
  });

  it('throws SearchProviderError when search tool is absent from getTools', async () => {
    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('batch_search', vi.fn())],
      parser,
      maxResults: 10,
      timeoutMs: 1000,
    });

    await expect(provider.search('q')).rejects.toThrow(SearchProviderError);
    await expect(provider.healthCheck(new AbortController().signal)).rejects.toThrow(SearchProviderError);
  });

  it('passes healthCheck when search tool is present', async () => {
    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('search', vi.fn())],
      parser,
      maxResults: 10,
      timeoutMs: 1000,
    });

    await expect(provider.healthCheck(new AbortController().signal)).resolves.toBeUndefined();
  });

  it('rejects with SearchProviderTimeoutError when tool invocation times out', async () => {
    const neverResolvingInvoke = (_args: unknown, config?: { signal?: AbortSignal }): Promise<unknown> =>
      new Promise((_, reject) => {
        if (config?.signal) {
          config.signal.addEventListener('abort', () => {
            const err = new Error('ToolException: McpError -32001: The operation was aborted due to timeout');
            err.name = 'ToolException';
            reject(err);
          });
        }
      });

    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('search', neverResolvingInvoke)],
      parser,
      maxResults: 10,
      timeoutMs: 50,
    });

    await expect(provider.search('hang')).rejects.toThrow(SearchProviderTimeoutError);
  });

  it('wraps generic tool execution errors in SearchProviderError', async () => {
    const failingInvoke = vi.fn().mockRejectedValue(new Error('Network error 500'));

    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('search', failingInvoke)],
      parser,
      maxResults: 10,
      timeoutMs: 1000,
    });

    await expect(provider.search('q')).rejects.toThrow(SearchProviderError);
  });

  it('propagates SearchResponseFormatError from parser without wrapping', async () => {
    const badFormatInvoke = vi.fn().mockResolvedValue('unparseable junk response');

    const provider = new AnySearchProvider({
      getTools: async () => [createMockTool('search', badFormatInvoke)],
      parser,
      maxResults: 10,
      timeoutMs: 1000,
    });

    await expect(provider.search('q')).rejects.toThrow(SearchResponseFormatError);
  });
});
