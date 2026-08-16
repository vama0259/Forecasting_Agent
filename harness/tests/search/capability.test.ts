// Tests for AnySearchCapability verifying orchestration of cache, budget ledger, allowlist, and storage.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import { AnySearchCapability } from '../../src/search/capability.js';
import { DomainAllowlist } from '../../src/search/allowlist.js';
import { SearchBudgetLedger } from '../../src/search/budget.js';
import { RunScopedSearchCache } from '../../src/search/cache.js';
import type { AnySearchProvider } from '../../src/search/provider.js';
import type { SearchObservation } from '../../src/storage/types.js';
import type { SearchResult } from '../../src/search/types.js';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let redis: Redis;
let prefix: string;
let n = 0;

beforeEach(() => {
  redis = new Redis(URL);
  prefix = `t21cap:${process.pid}:${n++}:`;
});

afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe('AnySearchCapability', () => {
  const sampleResults: SearchResult[] = [
    {
      rank: 1,
      title: 'Allowed Article',
      url: 'https://www.moneycontrol.com/news/1',
      hostname: 'www.moneycontrol.com',
      content: 'Good news',
    },
    {
      rank: 2,
      title: 'Disallowed Article',
      url: 'https://www.spam.com/news/2',
      hostname: 'www.spam.com',
      content: 'Spam news',
    },
  ];

  it('serves repeat queries from cache for 0 additional spend and reports cache source', async () => {
    const providerSearch = vi.fn().mockResolvedValue(sampleResults);
    const mockProvider = { search: providerSearch } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });
    const saved: SearchObservation[][] = [];
    const saveObservations = async (rows: SearchObservation[]) => {
      saved.push(rows);
    };

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations,
      initialBudget: 5,
    });

    await capability.beginRun('run-1');

    const first = await capability.search('run-1', 'Reliance Results');
    expect(first.source).toBe('provider');
    expect(first.results).toHaveLength(1);
    expect(first.results[0]?.hostname).toBe('www.moneycontrol.com');
    expect(first.degraded).toBe(false);
    expect(providerSearch).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);

    const second = await capability.search('run-1', 'reliance results');
    expect(second.source).toBe('cache');
    expect(second.results).toEqual(first.results);
    expect(second.degraded).toBe(false);
    expect(providerSearch).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it('returns degraded outcome without throwing when run budget is exhausted', async () => {
    const mockProvider = { search: vi.fn().mockResolvedValue([]) } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });
    const saveObservations = vi.fn();

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations,
      initialBudget: 1,
    });

    await capability.beginRun('run-exhaust');
    // First spend takes the 1 unit
    await capability.search('run-exhaust', 'query 1');

    // Second spend encounters budget exhaustion
    const outcome = await capability.search('run-exhaust', 'query 2');
    expect(outcome).toEqual({
      results: [],
      source: 'degraded',
      degraded: true,
    });
  });

  it('cache hit after degradation still reports degraded true', async () => {
    const mockProvider = {
      search: vi.fn().mockResolvedValue([sampleResults[0]]),
    } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations: async () => {},
      initialBudget: 1,
    });

    await capability.beginRun('run-deg-cache');
    await capability.search('run-deg-cache', 'cached query');

    // Exhaust budget
    await capability.search('run-deg-cache', 'exhausting query');

    // Re-query cached query
    const outcome = await capability.search('run-deg-cache', 'cached query');
    expect(outcome.source).toBe('cache');
    expect(outcome.degraded).toBe(true);
  });

  it('degradation survives a DEL of the run key via process-local backstop', async () => {
    const mockProvider = { search: vi.fn() } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations: async () => {},
      initialBudget: 0,
    });

    await capability.beginRun('run-local-deg');
    await capability.search('run-local-deg', 'q1');

    // Delete Redis run key
    await redis.del(`${prefix}run:run-local-deg`);

    const cachedOutcome = await capability.search('run-local-deg', 'q1');
    expect(cachedOutcome.degraded).toBe(true);
  });

  it('endRun refunds unused budget and clears the local degraded set', async () => {
    const mockProvider = { search: vi.fn() } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations: async () => {},
      initialBudget: 10,
    });

    await capability.beginRun('run-end');
    const refunded = await capability.endRun('run-end');
    expect(refunded).toBe(10);

    const exists = await redis.exists(`${prefix}run:run-end`);
    expect(exists).toBe(0);
  });

  it('persists both allowed and rejected results with appropriate flags in one call', async () => {
    const mockProvider = {
      search: vi.fn().mockResolvedValue(sampleResults),
    } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });
    let capturedRows: SearchObservation[] = [];
    const saveObservations = async (rows: SearchObservation[]) => {
      capturedRows = rows;
    };

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations,
      initialBudget: 5,
    });

    await capability.beginRun('run-obs');
    await capability.search('run-obs', 'RELIANCE Q3');

    expect(capturedRows).toHaveLength(2);
    expect(capturedRows.find((r) => r.hostname === 'www.moneycontrol.com')?.allowed).toBe(true);
    expect(capturedRows.find((r) => r.hostname === 'www.spam.com')?.allowed).toBe(false);
    expect(capturedRows[0]?.provider).toBe('anysearch');
    expect(capturedRows[0]?.query).toBe('RELIANCE Q3');
    expect(capturedRows[0]?.normalized_query).toBe('reliance q3');
  });

  it('propagates repository persistence errors without catching', async () => {
    const mockProvider = {
      search: vi.fn().mockResolvedValue(sampleResults),
    } as unknown as AnySearchProvider;
    const allowlist = new DomainAllowlist(['moneycontrol.com']);
    const ledger = new SearchBudgetLedger(redis, { dailyCap: 100, runTtlSeconds: 60, keyPrefix: prefix });
    const cache = new RunScopedSearchCache(redis, { runTtlSeconds: 60, keyPrefix: prefix });
    const saveObservations = vi.fn().mockRejectedValue(new Error('DB connection pool destroyed'));

    const capability = new AnySearchCapability({
      provider: mockProvider,
      allowlist,
      ledger,
      cache,
      saveObservations,
      initialBudget: 5,
    });

    await capability.beginRun('run-db-err');
    await expect(capability.search('run-db-err', 'q')).rejects.toThrow('DB connection pool destroyed');
  });
});
