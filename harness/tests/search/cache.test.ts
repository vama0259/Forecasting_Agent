// Tests for RunScopedSearchCache verifying query normalisation, hashing, caching, and run isolation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { RunScopedSearchCache } from '../../src/search/cache.js';
import type { SearchResult } from '../../src/search/types.js';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let redis: Redis;
let cache: RunScopedSearchCache;
let prefix: string;
let n = 0;

const results: SearchResult[] = [
  { rank: 1, title: 't', url: 'https://www.moneycontrol.com/a', hostname: 'www.moneycontrol.com', content: 'c' },
];

beforeEach(() => {
  redis = new Redis(URL);
  prefix = `t21c:${process.pid}:${n++}:`;
  cache = new RunScopedSearchCache(redis, { runTtlSeconds: 600, keyPrefix: prefix });
});

afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe('RunScopedSearchCache', () => {
  it('normalises case, whitespace and unicode form', () => {
    expect(cache.normalise('  Reliance   RESULTS\n')).toBe('reliance results');
    expect(cache.normalise('Reliance results')).toBe(cache.normalise('reliance   Results'));
  });

  it('round-trips results and misses for an unseen query', async () => {
    const k = cache.normalise('Reliance results');
    expect(await cache.get('A', k)).toBeNull();
    await cache.set('A', k, results);
    expect(await cache.get('A', k)).toEqual(results);
  });

  it('is scoped to the run — another run does not see the entry', async () => {
    const k = cache.normalise('Reliance results');
    await cache.set('A', k, results);
    expect(await cache.get('B', k)).toBeNull();
  });

  it('sets a bounded TTL, never a persistent key', async () => {
    const k = cache.normalise('Reliance results');
    await cache.set('A', k, results);
    const [key] = await redis.keys(`${prefix}cache:A:*`);
    expect(key).toBeDefined();
    const ttl = await redis.ttl(key!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('hashes the query rather than embedding it in the key', async () => {
    const k = cache.normalise('a query with spaces and: colons');
    await cache.set('A', k, results);
    const [key] = await redis.keys(`${prefix}cache:A:*`);
    expect(key).not.toContain('colons');
    expect(key).toMatch(/[0-9a-f]{64}$/);
  });
});
