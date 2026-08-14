// harness/tests/sandbox/manager-concurrency.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/sandbox/manager.js';

function makeMockDocker(execDelayMs: number) {
  const execCalls: string[] = [];
  const fakeExec = {
    start: vi.fn(async () => {
      execCalls.push('start');
      await new Promise((r) => setTimeout(r, execDelayMs));
      return {
        on: (event: string, cb: () => void) => {
          if (event === 'end') setTimeout(cb, 0);
        },
      };
    }),
  };
  const fakeContainer = {
    id: 'fake-container-id',
    exec: vi.fn(async () => fakeExec),
    inspect: vi.fn(async () => ({ State: { Running: true } })),
    kill: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
  };
  const fakeDocker = {
    createContainer: vi.fn(async () => fakeContainer),
    listContainers: vi.fn(async () => []),
  };
  return { fakeDocker, fakeContainer, execCalls };
}

describe('SandboxManager concurrency', () => {
  it('blocks a 3rd concurrent runExplore call until one of the first two releases', async () => {
    const { fakeDocker } = makeMockDocker(50);
    const mgr = new SandboxManager({ concurrency: 2 }, fakeDocker as never);

    const order: number[] = [];
    const call = (n: number, runId: string) =>
      mgr.runExplore({ runId, tier: 'explore', code: 'print(1)' }).then(() => order.push(n));

    await Promise.all([call(1, 'run-a'), call(2, 'run-b'), call(3, 'run-c')]);
    // All 3 must complete; the semaphore only delays, never drops.
    expect(order.sort()).toEqual([1, 2, 3]);
    await mgr.shutdown();
  });

  it('serializes two concurrent runExplore calls for the SAME run_id (per-run mutex)', async () => {
    const { fakeDocker } = makeMockDocker(30);
    const mgr = new SandboxManager({ concurrency: 2 }, fakeDocker as never);

    const timestamps: number[] = [];
    const call = () =>
      mgr.runExplore({ runId: 'shared-run', tier: 'explore', code: 'print(1)' }).then(() => {
        timestamps.push(Date.now());
      });

    const start = Date.now();
    await Promise.all([call(), call()]);
    // If serialized, the second call cannot finish before ~2x the exec delay has elapsed.
    expect(timestamps[1]! - start).toBeGreaterThanOrEqual(55);
    await mgr.shutdown();
  });
});
