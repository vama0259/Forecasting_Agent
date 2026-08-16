// Live smoke tests exercising AnySearch provider and quota metering end to end against the real API.

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { SearchBudgetLedger } from '../../src/search/budget.js';
import { RunScopedSearchCache } from '../../src/search/cache.js';
import { DomainAllowlist } from '../../src/search/allowlist.js';
import { AnySearchResultParser } from '../../src/search/parser.js';
import { AnySearchProvider } from '../../src/search/provider.js';
import { AnySearchCapability } from '../../src/search/capability.js';
import { buildSearchTool } from '../../src/search/tool.js';
import type { SearchOutcome } from '../../src/search/types.js';

const isLiveEnabled = Boolean(process.env.RUN_LIVE_SEARCH_E2E);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const API_KEY = process.env.ANYSEARCH_API_KEY ?? '';

describe.skipIf(!isLiveEnabled)('AnySearch live end-to-end smoke', () => {
  let redis: Redis;
  let ledger: SearchBudgetLedger;
  let cache: RunScopedSearchCache;
  let allowlist: DomainAllowlist;
  let parser: AnySearchResultParser;
  let mcpClient: MultiServerMCPClient;
  let provider: AnySearchProvider;
  let capability: AnySearchCapability;
  let prefix: string;
  let testNum = 0;

  beforeEach(() => {
    prefix = `live-smoke:${process.pid}:${testNum++}:`;
    redis = new Redis(REDIS_URL);
    ledger = new SearchBudgetLedger(redis, {
      dailyCap: 2000,
      runTtlSeconds: 600,
      keyPrefix: prefix,
    });
    cache = new RunScopedSearchCache(redis, {
      runTtlSeconds: 600,
      keyPrefix: prefix,
    });
    allowlist = new DomainAllowlist([
      'moneycontrol.com',
      'economictimes.indiatimes.com',
      'livemint.com',
      'bseindia.com',
      'nseindia.com',
    ]);
    parser = new AnySearchResultParser();

    mcpClient = new MultiServerMCPClient({
      anysearch: {
        transport: 'http',
        url: 'https://api.anysearch.com/mcp',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      },
    });

    provider = new AnySearchProvider({
      getTools: () => mcpClient.getTools(),
      parser,
      timeoutMs: 15000,
      maxResults: 10,
    });

    capability = new AnySearchCapability({
      provider,
      allowlist,
      ledger,
      cache,
      initialBudget: 5,
      saveObservations: async () => {},
    });
  });

  afterEach(async () => {
    if (redis) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      redis.disconnect();
    }
  });

  afterAll(async () => {
    if (mcpClient) {
      await mcpClient.close();
    }
  });

  it('exercises real search, verifies allowlist, cache hit, budget exhaustion, and release', async () => {
    const runId = `live-run-${Date.now()}`;
    const dailyKey = await ledger.dailyKey();
    const runKey = `${prefix}run:${runId}`;

    const preClaimDaily = Number((await redis.get(dailyKey)) ?? 0);
    const granted = await capability.beginRun(runId);
    expect(granted).toBe(5);

    const postClaimDaily = Number((await redis.get(dailyKey)) ?? 0);
    expect(postClaimDaily).toBe(preClaimDaily + 5);

    const searchTool = buildSearchTool(capability, runId);

    // 1. Real search invocation against live AnySearch
    const query = 'Reliance Industries quarterly results NSE';
    const firstRaw = await searchTool.invoke({ query });
    const firstOutcome = JSON.parse(firstRaw) as SearchOutcome;

    expect(firstOutcome.results.length).toBeGreaterThan(0);
    expect(firstOutcome.source).toBe('provider');
    expect(firstOutcome.degraded).toBe(false);
    for (const result of firstOutcome.results) {
      expect(allowlist.partition([result]).allowed.length).toBe(1);
    }

    const remainingAfterFirst = Number(await redis.hget(runKey, 'remaining'));
    expect(remainingAfterFirst).toBe(4);

    // 2. Repeat identical query -> verify cache hit and unchanged remaining
    const secondRaw = await searchTool.invoke({ query });
    const secondOutcome = JSON.parse(secondRaw) as SearchOutcome;

    expect(secondOutcome.source).toBe('cache');
    expect(secondOutcome.degraded).toBe(false);
    expect(secondOutcome.results).toEqual(firstOutcome.results);

    const remainingAfterSecond = Number(await redis.hget(runKey, 'remaining'));
    expect(remainingAfterSecond).toBe(4);

    // 3. Drain remaining budget and verify degradation without throwing
    for (let i = 0; i < 4; i++) {
      await ledger.spend(runId, 1);
    }
    const remainingAfterDrain = Number(await redis.hget(runKey, 'remaining'));
    expect(remainingAfterDrain).toBe(0);

    const thirdRaw = await searchTool.invoke({ query: 'HDFC Bank share price today' });
    const thirdOutcome = JSON.parse(thirdRaw) as SearchOutcome;

    expect(thirdOutcome.source).toBe('degraded');
    expect(thirdOutcome.degraded).toBe(true);
    expect(thirdOutcome.results).toEqual([]);

    // 4. endRun -> releases unused budget (0 units remaining in this drained run)
    const refunded = await capability.endRun(runId);
    expect(refunded).toBe(0);

    const postEndDaily = Number((await redis.get(dailyKey)) ?? 0);
    // Since 5 were granted, 4 spent directly and 1 spent by provider, net daily increase is 5
    expect(postEndDaily).toBe(preClaimDaily + 5);
  });
});
