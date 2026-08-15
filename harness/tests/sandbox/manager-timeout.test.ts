// harness/tests/sandbox/manager-timeout.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { SandboxTimeoutError } from '../../src/sandbox/types.js';

function makeSlowMockDocker() {
  const fakeContainer = {
    id: 'fake-container-id',
    exec: vi.fn(async () => ({
      start: vi.fn(async () => ({
        on: () => {
          // never calls back "end" -- simulates a hang past the timeout
        },
      })),
    })),
    inspect: vi.fn(async () => ({ State: { Running: true } })),
    kill: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    modem: {
      // Registers listeners but the underlying stream's `on()` mock never fires them --
      // simulates an exec that hangs forever, same as the real timeout scenario.
      demuxStream: vi.fn(() => {}),
    },
  };
  const fakeDocker = {
    createContainer: vi.fn(async () => fakeContainer),
    listContainers: vi.fn(async () => []),
  };
  return { fakeDocker, fakeContainer };
}

describe('SandboxManager timeout', () => {
  it('throws SandboxTimeoutError and kills+removes the container past the timeout', async () => {
    const { fakeDocker, fakeContainer } = makeSlowMockDocker();
    const mgr = new SandboxManager({ concurrency: 2, timeoutMs: 50 }, fakeDocker as never);

    await expect(mgr.runExplore({ runId: 'run-timeout', tier: 'explore', code: 'while True: pass' })).rejects.toThrow(
      SandboxTimeoutError,
    );

    expect(fakeContainer.kill).toHaveBeenCalled();
    expect(fakeContainer.remove).toHaveBeenCalled();
    await mgr.shutdown();
  });

  it('idle reaper does not kill a container whose per-run mutex is currently held', async () => {
    const { fakeDocker, fakeContainer } = makeSlowMockDocker();
    const mgr = new SandboxManager({ concurrency: 2, timeoutMs: 200, idleReaperMs: 10 }, fakeDocker as never);
    // Fire an explore call that will hold the run's mutex well past the reaper interval,
    // then trigger a reaper sweep manually and assert it does NOT remove the container
    // out from under the in-flight call.
    const inFlight = mgr.runExplore({ runId: 'run-r', tier: 'explore', code: 'x' });
    await new Promise((r) => setTimeout(r, 20)); // let the reaper interval fire at least once
    expect(fakeContainer.remove).not.toHaveBeenCalled();
    await mgr.shutdown(); // release the hung exec so the test doesn't leak a timer
    await inFlight.catch(() => {});
  });
});
