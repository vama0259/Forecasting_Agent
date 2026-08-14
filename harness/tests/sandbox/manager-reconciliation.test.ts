// harness/tests/sandbox/manager-reconciliation.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/sandbox/manager.js';

describe('SandboxManager.reconcile', () => {
  it('force-removes orphaned containers labeled sandbox.managed not in its own map', async () => {
    const orphan = { id: 'orphan-1', remove: vi.fn(async () => {}) };
    const fakeDocker = {
      listContainers: vi.fn(async () => [{ Id: 'orphan-1', Labels: { 'sandbox.managed': 'true' } }]),
      getContainer: vi.fn((id: string) => (id === 'orphan-1' ? orphan : undefined)),
      createContainer: vi.fn(),
    };
    const mgr = new SandboxManager({}, fakeDocker as never);
    await mgr.reconcile();
    expect(orphan.remove).toHaveBeenCalledWith({ force: true });
    await mgr.shutdown();
  });
});
