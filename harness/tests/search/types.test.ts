// Pins the config-schema half of #21: the stdio|http MCP transport union and the search/redis blocks.

import { describe, it, expect } from 'vitest';
import { HarnessConfigSchema } from '../../src/config.js';

const base = {
  llm: { provider: 'deepseek', model: 'm', api_key: 'k' },
  capabilities: { chat: 'llm', search: 'anysearch', sentiment: 'llm', market_data: 'market' },
  storage: { connection_string: 'postgres://x' },
  tracing: { langfuse_public_key: 'a', langfuse_secret_key: 'b', langfuse_base_url: 'http://x' },
  redis: { url: 'redis://127.0.0.1:6379' },
  search: {
    initial_run_budget: 20,
    daily_cap: 2000,
    run_ttl_seconds: 21600,
    provider_timeout_ms: 15000,
    max_results: 10,
    allowed_domains: ['moneycontrol.com'],
  },
};

describe('McpServerSchema transport union', () => {
  it('accepts an http server with headers', () => {
    const r = HarnessConfigSchema.safeParse({
      ...base,
      mcp_servers: {
        anysearch: { transport: 'http', url: 'https://api.anysearch.com/mcp', headers: { Authorization: 'Bearer x' } },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mcp_servers.anysearch).toMatchObject({ transport: 'http', headers: { Authorization: 'Bearer x' } });
    }
  });

  it('still accepts a stdio server', () => {
    const r = HarnessConfigSchema.safeParse({ ...base, mcp_servers: { market: { command: 'uv', args: ['run'] } } });
    expect(r.success).toBe(true);
  });

  it('rejects a url with no transport, and a malformed url', () => {
    expect(HarnessConfigSchema.safeParse({ ...base, mcp_servers: { a: { url: 'https://x/mcp' } } }).success).toBe(
      false,
    );
    expect(
      HarnessConfigSchema.safeParse({ ...base, mcp_servers: { a: { transport: 'http', url: 'nope' } } }).success,
    ).toBe(false);
  });
});

describe('search + redis config blocks', () => {
  it('fills in every search default when only allowed_domains is given', () => {
    const r = HarnessConfigSchema.safeParse({
      ...base,
      mcp_servers: {},
      search: { allowed_domains: ['moneycontrol.com'] },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.search).toMatchObject({
        initial_run_budget: 20,
        daily_cap: 2000,
        run_ttl_seconds: 21600,
        provider_timeout_ms: 15000,
        max_results: 10,
      });
    }
  });

  it('rejects a search block with no allowed_domains — the filter must never be empty by accident', () => {
    expect(HarnessConfigSchema.safeParse({ ...base, mcp_servers: {}, search: { allowed_domains: [] } }).success).toBe(
      false,
    );
  });

  it('rejects a non-positive run budget', () => {
    const r = HarnessConfigSchema.safeParse({
      ...base,
      mcp_servers: {},
      search: { ...base.search, initial_run_budget: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('requires a redis url', () => {
    const withoutRedis = { ...base };
    // @ts-expect-error testing missing required field
    delete withoutRedis.redis;
    expect(HarnessConfigSchema.safeParse({ ...withoutRedis, mcp_servers: {} }).success).toBe(false);
  });
});
