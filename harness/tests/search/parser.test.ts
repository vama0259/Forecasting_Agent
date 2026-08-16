// Tests for AnySearchResultParser verifying markdown parsing, URL extraction, and format error handling.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnySearchResultParser } from '../../src/search/parser.js';
import { SearchResponseFormatError } from '../../src/search/types.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/anysearch-search-response.json'), 'utf8'),
) as { response: { result: { content: { text: string }[] } } };
const BLOB = fixture.response.result.content[0]!.text;

describe('AnySearchResultParser', () => {
  const parser = new AnySearchResultParser();

  it('parses every result out of the real captured response', () => {
    const results = parser.parse(BLOB);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.hostname)).toEqual([
      'trendlyne.com',
      'www.ril.com',
      'www.screener.in',
      'www.business-standard.com',
      'www.moneycontrol.com',
    ]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(results.every((r) => r.title.length > 0)).toBe(true);
    expect(results.every((r) => r.content.length > 0)).toBe(true);
  });

  it('returns [] for a genuinely empty result set', () => {
    expect(parser.parse('## Search Results (0 results, 12ms)\n')).toEqual([]);
  });

  it('throws on a non-empty blob it cannot parse, rather than returning []', () => {
    expect(() => parser.parse('the provider changed its output format entirely')).toThrow(SearchResponseFormatError);
  });

  it('keeps a result whose URL is unparseable, with a null hostname', () => {
    const results = parser.parse('## Search Results (1 results, 1ms)\n\n### 1. Broken\n- **URL**: not-a-url\nbody\n');
    expect(results).toHaveLength(1);
    expect(results[0]!.hostname).toBeNull();
  });
});
