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
    writeFile: vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
      durationMs: 5,
    }),
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

  it('uploadFiles streams content through manager.writeFile and reports success', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');
    const bytes = new TextEncoder().encode('hi');

    const result = await adapter.uploadFiles([['/workspace/a.txt', bytes]]);

    expect(manager.writeFile).toHaveBeenCalledWith('run-123', '/workspace/a.txt', bytes);
    expect(result).toEqual([{ path: '/workspace/a.txt', error: null }]);
  });

  it('uploadFiles reports invalid_path on a non-zero exit code', async () => {
    const manager = makeMockManager();
    (manager.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: 'no such directory',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 1,
      durationMs: 5,
    });
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.uploadFiles([['/no/such/dir/a.txt', new Uint8Array()]]);

    expect(result).toEqual([{ path: '/no/such/dir/a.txt', error: 'invalid_path' }]);
  });

  it('downloadFiles base64-decodes runExplore stdout back into raw bytes', async () => {
    const manager = makeMockManager();
    (manager.runExplore as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: `${Buffer.from('hi').toString('base64')}\n`,
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
      durationMs: 5,
    });
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.downloadFiles(['/workspace/a.txt']);

    expect(result).toEqual([{ path: '/workspace/a.txt', content: new TextEncoder().encode('hi'), error: null }]);
  });

  it('downloadFiles reports file_not_found on a non-zero exit code', async () => {
    const manager = makeMockManager();
    (manager.runExplore as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: 'No such file or directory',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 1,
      durationMs: 5,
    });
    const adapter = new SandboxBackendAdapter(manager, 'run-123');

    const result = await adapter.downloadFiles(['/workspace/missing.txt']);

    expect(result).toEqual([{ path: '/workspace/missing.txt', content: null, error: 'file_not_found' }]);
  });

  it('dispose() delegates to manager.disposeRun with the constructed runId', async () => {
    const manager = makeMockManager();
    const adapter = new SandboxBackendAdapter(manager, 'run-123');
    await adapter.dispose();
    expect(manager.disposeRun).toHaveBeenCalledWith('run-123');
  });
});
