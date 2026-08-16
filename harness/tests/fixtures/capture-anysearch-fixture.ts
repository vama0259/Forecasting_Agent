// Regenerates anysearch-search-response.json by calling the live AnySearch MCP server once.
// Run manually with `npx tsx tests/fixtures/capture-anysearch-fixture.ts` only when the provider's
// response shape is suspected to have drifted -- it spends one unit of real search quota.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const QUERY = 'Reliance Industries quarterly results NSE';

// Takes nothing; writes the raw MCP tools/call response for one search to the fixture file.
async function capture(): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (process.env.ANYSEARCH_API_KEY) headers.Authorization = `Bearer ${process.env.ANYSEARCH_API_KEY}`;

  const response = await fetch('https://api.anysearch.com/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: QUERY, max_results: 5 } },
    }),
  });
  const payload = (await response.json()) as { result: { content: { type: string; text: string }[] } };
  const path = join(import.meta.dirname, 'anysearch-search-response.json');
  writeFileSync(path, `${JSON.stringify({ query: QUERY, response: payload }, null, 2)}\n`);
  console.log(`captured ${payload.result.content[0]?.text.length ?? 0} bytes of result text to ${path}`);
}

await capture();
