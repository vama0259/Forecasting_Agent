/**
 * Purpose: PostgreSQL adapter implementing advisory lock WriteBarrier.
 * Responsibility: Enforce shared locking on workloads and exclusive locking on backups.
 * Inputs/outputs: Lock acquisition requests; returns BarrierRelease handles.
 * Excludes: Table creation and data modification operations.
 */

import type {
  BarrierRelease,
  WriteBarrier,
} from '../../core/ports/write-barrier.port.js';
import type { PostgresPool } from './postgres-pool.js';

export const BACKUP_ADVISORY_LOCK_KEY = 42424242;

/**
 * PostgreSQL advisory lock implementation of the WriteBarrier port.
 */
export class PostgresWriteBarrier implements WriteBarrier {
  private readonly pool: PostgresPool;
  private readonly lockKey: number;

  /**
   * Initializes PostgreSQL write barrier with pool and optional custom lock key.
   * Sets default lock key constant if omitted.
   */
  constructor(pool: PostgresPool, lockKey: number = BACKUP_ADVISORY_LOCK_KEY) {
    this.pool = pool;
    this.lockKey = lockKey;
  }

  /**
   * Acquires a shared advisory lock permitting concurrent standard operations.
   * Returns BarrierRelease handle that unlocks and releases connection.
   */
  async acquireShared(): Promise<BarrierRelease> {
    const client = await this.pool.pool.connect();
    await client.query('SELECT pg_advisory_lock_shared($1)', [this.lockKey]);

    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock_shared($1)', [this.lockKey]);
        } finally {
          client.release();
        }
      },
    };
  }

  /**
   * Acquires exclusive advisory lock blocking writers during backup or restore.
   * Returns BarrierRelease handle that unlocks and releases connection.
   */
  async acquireExclusive(): Promise<BarrierRelease> {
    const client = await this.pool.pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [this.lockKey]);

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
