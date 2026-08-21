/**
 * Purpose: Unit tests for TwoSlotSemaphore concurrency limiter.
 * Responsibility: Verify slot acquisition, queuing, queue overflow, and timeouts.
 * Inputs/outputs: Async lease requests; concurrency and timing assertions.
 * Excludes: Container runtime scheduling.
 */

import { describe, it, expect } from 'vitest';
import { TwoSlotSemaphore } from '../../src/execution/semaphore.js';
import { ResourceLimitError } from '../../src/core/errors/resource-limit.error.js';

describe('TwoSlotSemaphore Unit Tests', () => {
  it('allows concurrent execution up to limit', async () => {
    const sem = new TwoSlotSemaphore({ maxConcurrency: 2 });
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();

    expect(sem.runningCount).toBe(2);
    expect(sem.waitingCount).toBe(0);

    release1();
    expect(sem.runningCount).toBe(1);

    release2();
    expect(sem.runningCount).toBe(0);
  });

  it('queues when slots are full and dequeues on release', async () => {
    const sem = new TwoSlotSemaphore({
      maxConcurrency: 1,
      maxQueueCapacity: 5,
    });
    const release1 = await sem.acquire();

    let task2Acquired = false;
    const task2Promise = sem.acquire().then((rel) => {
      task2Acquired = true;
      return rel;
    });

    expect(sem.runningCount).toBe(1);
    expect(sem.waitingCount).toBe(1);
    expect(task2Acquired).toBe(false);

    release1();

    const release2 = await task2Promise;
    expect(task2Acquired).toBe(true);
    expect(sem.runningCount).toBe(1);
    expect(sem.waitingCount).toBe(0);

    release2();
    expect(sem.runningCount).toBe(0);
  });

  it('rejects immediately when queue capacity is exceeded', async () => {
    const sem = new TwoSlotSemaphore({
      maxConcurrency: 1,
      maxQueueCapacity: 2,
    });
    const rel1 = await sem.acquire();

    const p1 = sem.acquire();
    const p2 = sem.acquire();
    expect(sem.waitingCount).toBe(2);

    await expect(sem.acquire()).rejects.toThrow(ResourceLimitError);

    rel1();
    const rel2 = await p1;
    rel2();
    const rel3 = await p2;
    rel3();
  });

  it('times out when waiting in queue exceeds timeout limit', async () => {
    const sem = new TwoSlotSemaphore({
      maxConcurrency: 1,
      maxQueueCapacity: 2,
      timeoutMs: 50,
    });
    const rel1 = await sem.acquire();

    await expect(sem.acquire()).rejects.toThrow(ResourceLimitError);
    rel1();
  });
});
