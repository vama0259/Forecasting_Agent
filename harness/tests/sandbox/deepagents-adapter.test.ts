// harness/tests/sandbox/deepagents-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxBackendAdapter } from '../../src/sandbox/deepagents-adapter.js';
import type { SandboxManager } from '../../src/sandbox/manager.js';

function makeMockManager(): SandboxManager {
  return {
    runExplore: vi.fn().mockResolvedValue({
      stdout: 'hello\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
      durationMs: 5,
    }),
    disposeRun: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxManager;
}

describe('SandboxBackendAdapter', () => {
  it('exposes the constructed runId as id', () => {
    const adapter = new SandboxBackendAdapter(makeMockManager(), 'run-123');
    expect(adapter.id).toBe('run-123');
  });

  it('execute() routes to runExplore with the runId and code, and maps the result', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.execute('print("hi")');

    expect(manager.runExplore).toHaveBeenCalledWith({
      runId: 'run-123',
      tier: 'explore',
      code: 'print("hi")',
    });
    expect(result).toEqual({ output: 'hello\n', exitCode: 0, truncated: false });
  });

  it('execute() combines stdout+stderr into output and ORs the truncation flags', async () => {
    const manager = makeMockManager();
    (manager.runExplore as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'out',
      stderr: 'err',
      stdoutTruncated: true,
      stderrTruncated: false,
      exitCode: 1,
      durationMs: 5,
    });
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.execute('boom');

    expect(result).toEqual({ output: 'outerr', exitCode: 1, truncated: true });
  });

  it('uploadFiles/downloadFiles return empty success arrays (no-op for this story)', async () => {
    const adapter = new SandboxBackendAdapter(makeMockManager(), 'run-123');
    await expect(adapter.uploadFiles([['a.txt', new Uint8Array()]])).resolves.toEqual([]);
    await expect(adapter.downloadFiles(['a.txt'])).resolves.toEqual([]);
  });

  it('dispose() delegates to manager.disposeRun with the constructed runId', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');
    await adapter.dispose();
    expect(manager.disposeRun).toHaveBeenCalledWith('run-123');
  });
});
