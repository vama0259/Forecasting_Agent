// SandboxBackendAdapter: bridges SandboxManager to deepagents BaseSandbox protocol per ADR-002/021.

import { BaseSandbox } from 'deepagents';
import type { ExecuteResponse, FileUploadResponse, FileDownloadResponse } from 'deepagents';
import type { SandboxManager } from './manager.js';

// Bridges a SandboxManager instance to deepagents BaseSandbox for one agent run.
export class SandboxBackendAdapter extends BaseSandbox {
  readonly id: string;
  readonly #manager: SandboxManager;

  // Takes a SandboxManager and runId; returns an adapter scoped to that run's warm container.
  constructor(manager: SandboxManager, runId: string) {
    super();
    this.#manager = manager;
    this.id = runId;
  }

  // Takes Python source as code; returns its ExecuteResponse via the explore tier.
  async execute(command: string): Promise<ExecuteResponse> {
    const result = await this.#manager.runExplore({ runId: this.id, tier: 'explore', code: command });
    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
      truncated: result.stdoutTruncated || result.stderrTruncated,
    };
  }

  // Takes file tuples; returns empty array as file upload is not supported in this story.
  uploadFiles(_files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    void _files;
    return Promise.resolve([]);
  }

  // Takes paths; returns empty array as file download is not supported in this story.
  downloadFiles(_paths: string[]): Promise<FileDownloadResponse[]> {
    void _paths;
    return Promise.resolve([]);
  }

  // Takes nothing; disposes the sandbox run and returns void.
  async dispose(): Promise<void> {
    await this.#manager.disposeRun(this.id);
  }
}
