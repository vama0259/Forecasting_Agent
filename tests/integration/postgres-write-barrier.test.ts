/**
 * Purpose: Integration tests for PostgresWriteBarrier advisory locks.
 * Responsibility: Verify that exclusive lock blocks concurrent shared locks.
 * Inputs/outputs: Multiple database sessions; concurrency blocking assertions.
 * Excludes: Local filesystem file locking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresWriteBarrier,
  // barrier
} from '../../src/adapters/postgres/postgres-write-barrier.js';

import { PostgresMigrator } from '../../src/adapters/postgres/postgres-migrator.js';

describe('PostgresWriteBarrier Integration', () => {
  let pool: PostgresPool;
  let barrier: PostgresWriteBarrier;
  let testOrgId: string;

  beforeAll(async () => {
    pool = new PostgresPool();
    const migrator = new PostgresMigrator(pool);
    await migrator.runMigrations();
    barrier = new PostgresWriteBarrier(pool);

    const res = await pool.query<{ id: string }>(
      `INSERT INTO organizations (slug, display_name)
       VALUES ($1, 'Barrier Org')
       ON CONFLICT (slug) DO UPDATE SET display_name = 'Barrier Org'
       RETURNING id`,
      [`barrier-org-${Date.now()}`],
    );
    testOrgId = res.rows[0]?.id as string;
  });

  afterAll(async () => {
    await pool.close();
  });

  it('allows multiple concurrent shared locks', async () => {
    const lock1 = await barrier.acquireShared();
    const lock2 = await barrier.acquireShared();

    await lock1.release();
    await lock2.release();
  });

  it('blocks concurrent acquisition while exclusive lock is held', async () => {
    const exclusiveLock = await barrier.acquireExclusive();
    let secondLockAcquired = false;

    // Start background attempt to acquire shared lock
    const acquirePromise = barrier.acquireShared().then((shared) => {
      secondLockAcquired = true;
      return shared;
    });

    // Give event loop time to ensure background promise is waiting
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondLockAcquired).toBe(false);

    // Release exclusive lock
    await exclusiveLock.release();

    const sharedLock = await acquirePromise;
    expect(secondLockAcquired).toBe(true);
    await sharedLock.release();
  });

  it('blocks table insert trigger while exclusive lock is held', async () => {
    const exclusiveLock = await barrier.acquireExclusive();
    let insertCompleted = false;

    const insertPromise = pool
      .query(
        `INSERT INTO principals (organization_id, display_name)
         VALUES ($1, 'Barrier Test Principal')`,
        [testOrgId],
      )
      .then(() => {
        insertCompleted = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(insertCompleted).toBe(false);

    await exclusiveLock.release();
    await insertPromise;
    expect(insertCompleted).toBe(true);
  });
});
