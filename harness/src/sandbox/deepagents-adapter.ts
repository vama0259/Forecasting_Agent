// SandboxBackendAdapter: bridges SandboxManager to deepagents BaseSandbox protocol per ADR-002/021.

import { BaseSandbox } from 'deepagents';
import type { ExecuteResponse, FileUploadResponse, FileDownloadResponse } from 'deepagents';
import type { SandboxManager } from './manager.js';

// Takes a POSIX path; returns it single-quoted for safe interpolation into a `sh -c` string.
function shellQuote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

// Bridges a SandboxManager instance to deepagents BaseSandbox for one agent run.
export class SandboxBackendAdapter extends BaseSandbox {
  readonly id: string;
  readonly #manager: SandboxManager;

  // Takes a SandboxManager and runId; returns an adapter scoped to that run's warm container.
  constructor(
    managerOrOptions: SandboxManager | { sandboxManager?: SandboxManager; manager?: SandboxManager; runId: string },
    runId?: string,
  ) {
    super();
    if (
      typeof managerOrOptions === 'object' &&
      managerOrOptions !== null &&
      ('sandboxManager' in managerOrOptions || 'manager' in managerOrOptions)
    ) {
      const opts = managerOrOptions as { sandboxManager?: SandboxManager; manager?: SandboxManager; runId: string };
      this.#manager = opts.sandboxManager ?? opts.manager!;
      this.id = opts.runId;
    } else {
      this.#manager = managerOrOptions as SandboxManager;
      this.id = runId ?? 'default-run';
    }
  }

  // Takes Python source as code; returns its ExecuteResponse via the explore tier.
  async execute(command: string): Promise<ExecuteResponse> {
    const start = Date.now();
    console.error(`[${this.id}] adapter.execute: start (${command.length} chars): ${command.slice(0, 120)}`);
    const result = await this.#manager.runExplore({ runId: this.id, tier: 'explore', code: command });
    console.error(`[${this.id}] adapter.execute: done in ${Date.now() - start}ms exitCode=${result.exitCode}`);
    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
      truncated: result.stdoutTruncated || result.stderrTruncated,
    };
  }

  // Takes [path, bytes] tuples; base64-round-trips each through the explore-tier shell
  // (binary-safe, no Docker archive API needed) and returns per-file upload results.
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];
    for (const [path, bytes] of files) {
      const start = Date.now();
      console.error(`[${this.id}] adapter.uploadFiles: start path=${path} bytes=${bytes.length}`);
      const base64 = Buffer.from(bytes).toString('base64');
      const dir = shellQuote(path.slice(0, path.lastIndexOf('/')) || '/');
      const command = `mkdir -p ${dir} && printf '%s' '${base64}' | base64 -d > ${shellQuote(path)}`;
      const result = await this.#manager.runExplore({ runId: this.id, tier: 'explore', code: command });
      console.error(
        `[${this.id}] adapter.uploadFiles: done in ${Date.now() - start}ms path=${path} exitCode=${result.exitCode}`,
      );
      results.push({ path, error: result.exitCode === 0 ? null : 'invalid_path' });
    }
    return results;
  }

  // Takes file paths; base64-reads each back out through the explore-tier shell and returns
  // per-file raw bytes (or a file_not_found error on non-zero exit).
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const results: FileDownloadResponse[] = [];
    for (const path of paths) {
      const start = Date.now();
      console.error(`[${this.id}] adapter.downloadFiles: start path=${path}`);
      const result = await this.#manager.runExplore({
        runId: this.id,
        tier: 'explore',
        code: `base64 -w0 ${shellQuote(path)}`,
      });
      console.error(
        `[${this.id}] adapter.downloadFiles: done in ${Date.now() - start}ms path=${path} exitCode=${result.exitCode}`,
      );
      if (result.exitCode !== 0) {
        results.push({ path, content: null, error: 'file_not_found' });
        continue;
      }
      results.push({ path, content: new Uint8Array(Buffer.from(result.stdout.trim(), 'base64')), error: null });
    }
    return results;
  }

  // Takes nothing; disposes the sandbox run and returns void.
  async dispose(): Promise<void> {
    await this.#manager.disposeRun(this.id);
  }
}
