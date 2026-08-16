// Tests for SearchBudgetLedger verifying Lua script metering, idempotence, release, and degradation flags.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { SearchBudgetLedger } from '../../src/search/budget.js';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let redis: Redis;
let ledger: SearchBudgetLedger;
let prefix: string;
let n = 0;

beforeEach(() => {
  redis = new Redis(URL);
  prefix = `t21:${process.pid}:${n++}:`;
  ledger = new SearchBudgetLedger(redis, { dailyCap: 2000, runTtlSeconds: 600, keyPrefix: prefix });
});

afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe('SearchBudgetLedger', () => {
  it('a run cannot exceed its allocation', async () => {
    await ledger.claim('A', 20);
    let ok = 0;
    for (let i = 0; i < 21; i += 1) if ((await ledger.spend('A', 1)) === 1) ok += 1;
    expect(ok).toBe(20);
  });

  it('a runaway run exhausts only its own budget', async () => {
    await ledger.claim('A', 20);
    for (let i = 0; i < 20; i += 1) await ledger.spend('A', 1);
    expect((await ledger.claim('B', 20)).granted).toBe(20);
    expect(await ledger.spend('B', 1)).toBe(1);
  });

  it('claim is idempotent and does not double-allocate', async () => {
    const first = await ledger.claim('A', 20);
    const second = await ledger.claim('A', 20);
    expect(first).toEqual({ granted: 20, reused: false });
    expect(second).toEqual({ granted: 20, reused: true });
    expect(Number(await redis.get(await ledger.dailyKey()))).toBe(20);
  });

  it('grants partially when the daily pool is nearly exhausted', async () => {
    await redis.set(await ledger.dailyKey(), 1993);
    expect((await ledger.claim('C', 20)).granted).toBe(7);
  });

  it('release refunds the remainder exactly once', async () => {
    await ledger.claim('A', 20);
    await ledger.spend('A', 5);
    expect(await ledger.release('A')).toBe(15);
    expect(await ledger.release('A')).toBe(0);
    expect(Number(await redis.get(await ledger.dailyKey()))).toBe(5);
  });

  it('distinguishes an exhausted run from one with no allocation', async () => {
    await ledger.claim('A', 1);
    await ledger.spend('A', 1);
    expect(await ledger.spend('A', 1)).toBe(0);
    expect(await ledger.spend('NEVER-CLAIMED', 1)).toBe(-1);
  });

  it('anchors the daily key to IST midnight, not 86400 seconds out', async () => {
    await ledger.claim('A', 1);
    const ttl = await redis.ttl(await ledger.dailyKey());
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90000);
    expect(ttl).not.toBe(86400);
  });

  it('markDegraded never resurrects an expired run key', async () => {
    const key = `${prefix}run:GONE`;
    await redis.del(key);
    expect(await ledger.markDegraded('GONE')).toBe(false);
    expect(await redis.exists(key)).toBe(0);
  });

  it('markDegraded sets the flag and preserves the run key TTL', async () => {
    await ledger.claim('A', 20);
    const before = await redis.ttl(`${prefix}run:A`);
    expect(await ledger.markDegraded('A')).toBe(true);
    expect(await ledger.isDegraded('A')).toBe(true);
    expect(await redis.ttl(`${prefix}run:A`)).toBeLessThanOrEqual(before);
    expect(await redis.ttl(`${prefix}run:A`)).toBeGreaterThan(before - 5);
  });
});
