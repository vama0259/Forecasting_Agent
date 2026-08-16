// Tests for buildSearchTool verifying LangChain StructuredTool construction, run ID closure, and schema.

import { describe, it, expect, vi } from 'vitest';
import { buildSearchTool } from '../../src/search/tool.js';
import type { SearchCapability, SearchOutcome } from '../../src/search/types.js';

describe('buildSearchTool', () => {
  it('creates a StructuredTool named search_news that binds runId', async () => {
    const outcome: SearchOutcome = {
      results: [{ rank: 1, title: 'T', url: 'https://x/', hostname: 'x', content: 'C' }],
      source: 'provider',
      degraded: false,
    };
    const cap: SearchCapability = { search: vi.fn().mockResolvedValue(outcome) };
    const t = buildSearchTool(cap, 'run-42');

    expect(t.name).toBe('search_news');
    expect(t.description).toContain('approved financial portals');

    const out = await t.invoke({ query: 'Reliance earnings' });
    expect(JSON.parse(out)).toEqual(outcome);
    expect(cap.search).toHaveBeenCalledWith('run-42', 'Reliance earnings');
  });

  it('rejects an empty query at the schema level', async () => {
    const cap: SearchCapability = { search: vi.fn() };
    const t = buildSearchTool(cap, 'run-42');
    await expect(t.invoke({ query: '' })).rejects.toThrow();
    expect(cap.search).not.toHaveBeenCalled();
  });
});
