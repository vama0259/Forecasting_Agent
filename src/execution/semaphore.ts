/**
 * Purpose: Concurrency limiter with queue capacity and timeout bounds.
 * Responsibility: Regulate concurrent sandbox executions to prevent exhaustion.
 * Inputs/outputs: Concurrency limit, lease requests; returns release callbacks.
 * Excludes: Container lifecycle management and OS process scheduling.
 */

import { ResourceLimitError } from '../core/errors/resource-limit.error.js';

/** Configuration options for the concurrent execution semaphore. */
export interface SemaphoreOptions {
  readonly maxConcurrency?: number;
  readonly maxQueueCapacity?: number;
  readonly timeoutMs?: number;
}

interface QueuedItem {
  readonly resolve: (release: () => void) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Strict in-memory semaphore bounding concurrent sandbox execution slots.
 */
export class TwoSlotSemaphore {
  private readonly maxConcurrency: number;
  private readonly maxQueueCapacity: number;
  private readonly timeoutMs: number;
  private activeCount: number = 0;
  private readonly queue: QueuedItem[] = [];

  /**
   * Initializes semaphore with concurrency, queue depth, and timeout limits.
   * Sets default 2 slots, queue depth 10, timeout 30s.
   */
  constructor(options: SemaphoreOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.maxQueueCapacity = options.maxQueueCapacity ?? 10;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Returns the count of currently leased execution slots.
   */
  get runningCount(): number {
    return this.activeCount;
  }

  /**
   * Returns the count of requests waiting in the FIFO queue.
   */
  get waitingCount(): number {
    return this.queue.length;
  }

  /**
   * Acquires an execution slot or queues until one is available.
   * Resolves with release callback or throws ResourceLimitError on full queue.
   */
  async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    if (this.queue.length >= this.maxQueueCapacity) {
      throw new ResourceLimitError(
        'SANDBOX_QUEUE_CAPACITY_EXCEEDED',
        `Sandbox semaphore queue capacity (${this.maxQueueCapacity}) exceeded`,
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(
          new ResourceLimitError(
            'SEMAPHORE_TIMEOUT',
            `Sandbox semaphore acquisition timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);

      this.queue.push({
        resolve: (release) => {
          clearTimeout(timer);
          resolve(release);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  /**
   * Releases an active slot and drains the next waiting request in the queue.
   */
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      let released = false;
      next.resolve(() => {
        if (!released) {
          released = true;
          this.release();
        }
      });
    } else {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  /**
   * Executes an asynchronous task within an acquired semaphore lease.
   * Automatically releases the lease upon task completion or failure.
   */
  async withLease<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}
