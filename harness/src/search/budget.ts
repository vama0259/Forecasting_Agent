// Redis-backed search budget ledger managing per-run quota allocation and atomic state transitions.

import type { Redis } from 'ioredis';

const CLAIM_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {tonumber(redis.call('HGET', KEYS[1], 'granted')), 1}
end
local used  = tonumber(redis.call('GET', KEYS[2]) or '0')
local grant = math.min(tonumber(ARGV[1]), tonumber(ARGV[2]) - used)
if grant < 0 then grant = 0 end
if grant > 0 then redis.call('INCRBY', KEYS[2], grant) end
if redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIREAT', KEYS[2], tonumber(ARGV[4])) end
redis.call('HSET', KEYS[1], 'granted', grant, 'remaining', grant, 'degraded', 0)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return {grant, 0}
`;

const SPEND_LUA = `
local remaining = redis.call('HGET', KEYS[1], 'remaining')
if remaining == false then return -1 end
remaining = tonumber(remaining)
local n = tonumber(ARGV[1])
if remaining < n then return 0 end
redis.call('HINCRBY', KEYS[1], 'remaining', -n)
return n
`;

const RELEASE_LUA = `
local remaining = redis.call('HGET', KEYS[1], 'remaining')
if remaining == false then return 0 end
redis.call('DEL', KEYS[1])
local r = tonumber(remaining)
if r > 0 then redis.call('DECRBY', KEYS[2], r) end
return r
`;

const MARK_DEGRADED_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'degraded', 1)
return 1
`;

// Options for configuring search budget limits, key prefixing, and run key expiry.
export interface SearchBudgetLedgerOptions {
  dailyCap: number;
  runTtlSeconds: number;
  keyPrefix?: string;
}

// Manages per-run search quota allocations, deductions, refunds, and degradation flags in Redis.
export class SearchBudgetLedger {
  private readonly redis: Redis;
  private readonly dailyCap: number;
  private readonly runTtlSeconds: number;
  private readonly prefix: string;

  constructor(redis: Redis, opts: SearchBudgetLedgerOptions) {
    this.redis = redis;
    this.dailyCap = opts.dailyCap;
    this.runTtlSeconds = opts.runTtlSeconds;
    this.prefix = opts.keyPrefix ?? 'search:';

    this.redis.defineCommand('claimBudget', { numberOfKeys: 2, lua: CLAIM_LUA });
    this.redis.defineCommand('spendBudget', { numberOfKeys: 1, lua: SPEND_LUA });
    this.redis.defineCommand('releaseBudget', { numberOfKeys: 2, lua: RELEASE_LUA });
    this.redis.defineCommand('markDegradedRun', { numberOfKeys: 1, lua: MARK_DEGRADED_LUA });
  }

  // Returns current IST date string and next IST midnight expiry epoch seconds with grace.
  private getIstDateAndExpiry(): { istDate: string; expiryEpochSeconds: number } {
    const istOffsetMs = 5.5 * 3600 * 1000;
    const istNow = new Date(Date.now() + istOffsetMs);
    const year = istNow.getUTCFullYear();
    const month = String(istNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istNow.getUTCDate()).padStart(2, '0');
    const istDate = `${year}-${month}-${day}`;

    const nextMidnightUtcMs = Date.UTC(year, istNow.getUTCMonth(), istNow.getUTCDate() + 1, 0, 0, 0) - istOffsetMs;
    const expiryEpochSeconds = Math.floor(nextMidnightUtcMs / 1000) + 3600;

    return { istDate, expiryEpochSeconds };
  }

  // Computes and returns the current IST-dated quota counter key.
  async dailyKey(): Promise<string> {
    const { istDate } = this.getIstDateAndExpiry();
    return `${this.prefix}quota:${istDate}`;
  }

  // Claims up to n search units for the specified run ID, returning grant count and reuse indicator.
  async claim(runId: string, n: number): Promise<{ granted: number; reused: boolean }> {
    const runKey = `${this.prefix}run:${runId}`;
    const { istDate, expiryEpochSeconds } = this.getIstDateAndExpiry();
    const dailyKey = `${this.prefix}quota:${istDate}`;

    const result = (await (
      this.redis as unknown as {
        claimBudget(k1: string, k2: string, a1: number, a2: number, a3: number, a4: number): Promise<[number, number]>;
      }
    ).claimBudget(runKey, dailyKey, n, this.dailyCap, this.runTtlSeconds, expiryEpochSeconds)) as [number, number];

    return {
      granted: Number(result[0]),
      reused: Number(result[1]) === 1,
    };
  }

  // Attempts to spend units from a run's allocation, returning spent count, 0 if denied, or -1 if missing.
  async spend(runId: string, units: number): Promise<number> {
    const runKey = `${this.prefix}run:${runId}`;
    const result = await (
      this.redis as unknown as {
        spendBudget(k1: string, a1: number): Promise<number>;
      }
    ).spendBudget(runKey, units);

    return Number(result);
  }

  // Releases remaining budget for a run, deletes the run key, and refunds unused units to the daily pool.
  async release(runId: string): Promise<number> {
    const runKey = `${this.prefix}run:${runId}`;
    const { istDate } = this.getIstDateAndExpiry();
    const dailyKey = `${this.prefix}quota:${istDate}`;

    const result = await (
      this.redis as unknown as {
        releaseBudget(k1: string, k2: string): Promise<number>;
      }
    ).releaseBudget(runKey, dailyKey);

    return Number(result);
  }

  // Marks a run as degraded if its run key exists in Redis, returning true on success or false if absent.
  async markDegraded(runId: string): Promise<boolean> {
    const runKey = `${this.prefix}run:${runId}`;
    const result = await (
      this.redis as unknown as {
        markDegradedRun(k1: string): Promise<number>;
      }
    ).markDegradedRun(runKey);

    return Number(result) === 1;
  }

  // Checks whether the specified run key has its degraded flag set to 1 in Redis.
  async isDegraded(runId: string): Promise<boolean> {
    const runKey = `${this.prefix}run:${runId}`;
    const value = await this.redis.hget(runKey, 'degraded');
    return value === '1';
  }
}
