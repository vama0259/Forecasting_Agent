/**
 * Purpose: Integration test for PostgresBrokerLock singleton session lock.
 * Responsibility: Verify only one broker instance holds the lock at a time.
 * Inputs/outputs: PostgresBrokerLock; asserts exclusion on concurrent acquire.
 * Excludes: Long-running broker workload execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresBrokerLock,
  // lock
} from '../../src/adapters/postgres/postgres-broker-lock.js';

describe('PostgresBrokerLock Integration Tests', () => {
  let pool: PostgresPool;

  beforeAll(() => {
    pool = new PostgresPool();
  });

  afterAll(async () => {
    await pool.close();
  });

  it('acquires singleton lock and blocks second broker instance', async () => {
    const broker1 = new PostgresBrokerLock(pool);
    const broker2 = new PostgresBrokerLock(pool);

    const release1 = await broker1.acquire();

    await expect(broker2.acquire()).rejects.toThrow(
      /Failed to acquire BROKER_SINGLETON advisory lock/,
    );

    await release1.release();

    const release2 = await broker2.acquire();
    expect(release2).toBeDefined();
    await release2.release();
  });
});
