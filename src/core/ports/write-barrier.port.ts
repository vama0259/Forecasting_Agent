/**
 * Purpose: Consumer-owned port interface for global backup write barriers.
 * Responsibility: Coordinate shared writer locking and exclusive backup acquisition.
 * Inputs/outputs: Shared or exclusive lock acquisitions; returns release handle.
 * Excludes: Database socket communication and POSIX signal handling.
 */

/**
 * Handle returned upon acquiring a write barrier lock to allow release.
 */
export interface BarrierRelease {
  /**
   * Releases the acquired write barrier lock.
   * Resolves when lock is released or throws if release fails.
   */
  release(): Promise<void>;
}

/**
 * Interface coordinating read/write barriers between workloads and backup operations.
 */
export interface WriteBarrier {
  /**
   * Acquires shared write barrier lock permitting concurrent standard operations.
   * Returns BarrierRelease handle that must be invoked after transaction completes.
   */
  acquireShared(): Promise<BarrierRelease>;

  /**
   * Acquires exclusive write barrier lock blocking all writers during backup/restore.
   * Returns BarrierRelease handle to be invoked when backup/restore concludes.
   */
  acquireExclusive(): Promise<BarrierRelease>;
}
