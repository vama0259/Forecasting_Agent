/**
 * Purpose: PostgreSQL adapter implementing broker singleton advisory session lock.
 * Responsibility: Ensure single active broker daemon per database installation.
 * Inputs/outputs: Lock acquisition requests; returns BrokerLockRelease handles.
 * Excludes: Table mutation and business workflow execution.
 */

import type { PostgresPool } from './postgres-pool.js';

export const BROKER_SINGLETON_ADVISORY_KEY = 84848484;

/** Handle for releasing an acquired broker singleton advisory session lock. */
export interface BrokerLockRelease {
  readonly release: () => Promise<void>;
}

/**
 * PostgreSQL advisory lock manager enforcing singleton execution broker daemon.
 */
export class PostgresBrokerLock {
  private readonly pool: PostgresPool;
  private readonly lockKey: number;

  /**
   * Initializes PostgreSQL broker lock manager with pool and optional custom key.
   * Sets default broker singleton advisory lock key constant if omitted.
   */
  constructor(pool: PostgresPool, lockKey: number = BROKER_SINGLETON_ADVISORY_KEY) {
    this.pool = pool;
    this.lockKey = lockKey;
  }

  /**
   * Acquires the exclusive session-level broker singleton advisory lock.
   * Returns BrokerLockRelease handle or throws if another broker instance is running.
   */
  async acquire(): Promise<BrokerLockRelease> {
    const client = await this.pool.pool.connect();
    const res = await client.query<{ readonly acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [this.lockKey],
    );

    const acquired = Boolean(res.rows[0]?.acquired);
    if (!acquired) {
      client.release();
      throw new Error(
        `Failed to acquire BROKER_SINGLETON advisory lock (${this.lockKey}): ` +
          `another broker instance is currently active.`,
      );
    }

    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [this.lockKey]);
        } finally {
          client.release();
        }
      },
    };
  }
}
