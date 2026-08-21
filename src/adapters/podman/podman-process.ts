/**
 * Purpose: Low-level process execution wrapper for invoking rootless Podman CLI.
 * Responsibility: Execute child processes with timeouts, backpressure, and buffering.
 * Inputs/outputs: Command args, stdin buffer; returns exit code, stdout, stderr.
 * Excludes: Domain policy enforcement and sandbox lifecycle decisions.
 */

import { spawn } from 'node:child_process';

/** Options for spawning a Podman process. */
export interface PodmanExecOptions {
  readonly argv: readonly string[];
  readonly timeoutMs?: number;
  readonly stdin?: Buffer | null;
  readonly env?: NodeJS.ProcessEnv;
}

/** Result containing status codes and captured buffers from Podman command. */
export interface PodmanExecResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

/**
 * Executes a podman command line with argument isolation and timeout handling.
 * Returns decoded stdout, stderr, and exit status.
 */
export async function runPodman(options: PodmanExecOptions): Promise<PodmanExecResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 120000;

  return new Promise<PodmanExecResult>((resolve, reject) => {
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    const child = spawn('podman', options.argv as string[], {
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (options.stdin && options.stdin.length > 0) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;
      resolve({
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        durationMs,
        timedOut,
      });
    });
  });
}
