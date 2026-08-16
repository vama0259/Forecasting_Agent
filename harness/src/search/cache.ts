// Run-scoped Redis cache for normalised search queries with automatic TTL eviction.

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { SearchResult } from './types.js';

// Options for configuring cache key prefix and key TTL duration.
export interface RunScopedSearchCacheOptions {
  runTtlSeconds: number;
  keyPrefix?: string;
}

// Caches search results within a single run scope, keyed by hashed normalised query text.
export class RunScopedSearchCache {
  private readonly redis: Redis;
  private readonly runTtlSeconds: number;
  private readonly prefix: string;

  constructor(redis: Redis, opts: RunScopedSearchCacheOptions) {
    this.redis = redis;
    this.runTtlSeconds = opts.runTtlSeconds;
    this.prefix = opts.keyPrefix ?? 'search:';
  }

  // Normalises query text by applying NFKC unicode form, lowercasing, and collapsing whitespace.
  normalise(query: string): string {
    return query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Computes the hashed Redis cache key for the given run ID and normalised query string.
  private cacheKey(runId: string, normalised: string): string {
    const hash = createHash('sha256').update(normalised).digest('hex');
    return `${this.prefix}cache:${runId}:${hash}`;
  }

  // Retrieves cached search results for a run and normalised query, or returns null on a cache miss.
  async get(runId: string, normalised: string): Promise<SearchResult[] | null> {
    const key = this.cacheKey(runId, normalised);
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as SearchResult[];
  }

  // Stores search results in Redis for a run and normalised query with run TTL expiry.
  async set(runId: string, normalised: string, results: SearchResult[]): Promise<void> {
    const key = this.cacheKey(runId, normalised);
    await this.redis.set(key, JSON.stringify(results), 'EX', this.runTtlSeconds);
  }
}
