// Wraps a shared SandboxBackendAdapter to persist every .py file write as a debate_traces row.
// The underlying adapter/workspace is shared across all 4 participants within one round (see
// deepagents-adapter.ts), so agent identity can't be inferred from the adapter itself -- this
// wrapper is constructed fresh per agent, closing over the correct forecastId/roundNumber/
// agentName, so concurrent writes from different agents still attribute correctly.
import { BaseSandbox } from 'deepagents';
import type { ExecuteResponse, FileUploadResponse, FileDownloadResponse } from 'deepagents';
import type { Pool } from 'pg';
import type { SandboxBackendAdapter } from './deepagents-adapter.js';
import { saveDebateTrace } from '../storage/repository.js';

export interface ScriptTraceContext {
  pool: Pool;
  forecastId: string;
  roundNumber: number;
  agentName: string;
}

// Wraps an existing SandboxBackendAdapter; forwards execute/downloadFiles/dispose unchanged and
// additionally persists every successfully-written .py file to debate_traces on uploadFiles.
export class TracingSandboxAdapter extends BaseSandbox {
  readonly id: string;

  constructor(
    private readonly inner: SandboxBackendAdapter,
    private readonly ctx: ScriptTraceContext,
  ) {
    super();
    this.id = inner.id;
  }

  execute(command: string): Promise<ExecuteResponse> {
    return this.inner.execute(command);
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results = await this.inner.uploadFiles(files);
    // Trace-persistence failures must not break the agent's actual work -- this is audit
    // logging, not forecast-affecting state, so log loudly and continue rather than throw.
    await Promise.all(
      files.map(async ([path, bytes], i) => {
        if (!path.endsWith('.py') || results[i]?.error) return;
        try {
          await saveDebateTrace(this.ctx.pool, {
            forecast_run_id: this.ctx.forecastId,
            round_number: this.ctx.roundNumber,
            content: {
              agent_name: this.ctx.agentName,
              file_path: path,
              code: Buffer.from(bytes).toString('utf8'),
              written_at: new Date().toISOString(),
            },
          });
        } catch (err) {
          console.error(`[trace] Failed to persist script ${path} for ${this.ctx.agentName}:`, err);
        }
      }),
    );
    return results;
  }

  downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    return this.inner.downloadFiles(paths);
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}
