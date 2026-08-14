// harness/src/sandbox/manager.ts
// SandboxManager: owns explore (warm, PyPI) and validate (cold, --network none) container
// execution per ADR-021/027, enforcing Semaphore(2), 45s timeout, and 50KB stdout/stderr caps.

import Dockerode from 'dockerode';
import { Mutex, Semaphore } from 'async-mutex';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { RingBuffer } from './ring-buffer.js';
import {
  ExecutionRequestSchema,
  EvalResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
  type SandboxConfig,
  SandboxTimeoutError,
  ValidationFailedError,
  SandboxError,
} from './types.js';

type ResolvedSandboxConfig = {
  concurrency: number;
  timeoutMs: number;
  stdioBufferBytes: number;
  idleReaperMs: number;
  memoryLimitBytes: number;
  cpuLimit: number;
};

const DEFAULTS: ResolvedSandboxConfig = {
  concurrency: 2,
  timeoutMs: 45_000,
  stdioBufferBytes: 50 * 1024,
  idleReaperMs: 10 * 60_000,
  memoryLimitBytes: 512 * 1024 * 1024,
  cpuLimit: 1.0,
};

interface WarmEntry {
  container: Dockerode.Container;
  lastActivityMs: number;
}

// Takes nothing; returns the monorepo root, derived from this file's own location
// (harness/src/sandbox/manager.ts -> ../../..) rather than process.cwd(), since cwd
// varies with the caller's invocation directory (e.g. vitest run from harness/) and
// a wrong root silently causes Docker to auto-create empty directories on the host.
function repoRootFromModule(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(thisFile, '..', '..', '..', '..');
}

// Owns warm/cold container lifecycle and enforces ADR-021's concurrency/timeout/buffer limits.
export class SandboxManager {
  private readonly config: ResolvedSandboxConfig;
  private readonly docker: Dockerode;
  private readonly semaphore: Semaphore;
  private readonly runMutexes = new Map<string, Mutex>();
  private readonly warmContainers = new Map<string, WarmEntry>();
  private readonly reaperHandle: ReturnType<typeof setInterval>;

  // Takes optional config and an optional injectable Docker client (for tests); returns a manager.
  constructor(config: SandboxConfig = {}, dockerImpl?: Dockerode) {
    this.config = { ...DEFAULTS, ...config };
    this.docker = dockerImpl ?? new Dockerode();
    this.semaphore = new Semaphore(this.config.concurrency);
    this.reaperHandle = setInterval(() => {
      void this.reapIdle();
    }, this.config.idleReaperMs);
  }

  // Takes a run_id; returns its Mutex, creating one if this is the first call for that run.
  private mutexFor(runId: string): Mutex {
    let m = this.runMutexes.get(runId);
    if (!m) {
      m = new Mutex();
      this.runMutexes.set(runId, m);
    }
    return m;
  }

  // Takes an explore ExecutionRequest; returns its ExecutionResult after warm-container exec.
  async runExplore(reqInput: ExecutionRequest): Promise<ExecutionResult> {
    const req = ExecutionRequestSchema.parse(reqInput);
    const mutex = this.mutexFor(req.runId);
    return mutex.runExclusive(async () => {
      const entry = await this.getOrCreateWarmContainer(req.runId, req.workspacePath);
      entry.lastActivityMs = Date.now();
      return this.semaphore.runExclusive(() =>
        this.execWithTimeout(entry.container, req.code ?? '', req.runId, /* isExplore */ true),
      );
    });
  }

  // Takes a validate ExecutionRequest; returns its ExecutionResult from a fresh,
  // --network none container running the fixed validate.py entrypoint.
  async runValidate(reqInput: ExecutionRequest): Promise<ExecutionResult> {
    const req = ExecutionRequestSchema.parse(reqInput);
    if (!req.modelScriptPath) {
      throw new SandboxError('runValidate requires modelScriptPath');
    }
    return this.semaphore.runExclusive(async () => {
      const stdout = new RingBuffer(this.config.stdioBufferBytes);
      const stderr = new RingBuffer(this.config.stdioBufferBytes);
      const start = Date.now();
      const repoRoot = repoRootFromModule();

      const container = await this.docker.createContainer({
        Image: 'forecasting-sandbox:latest',
        Cmd: ['python', '/entrypoints/validate.py'],
        Env: [`MODEL_SCRIPT_PATH=/workspace/model.py`, `PYTHONPATH=/workspace/m8`],
        Labels: { 'sandbox.managed': 'true', 'sandbox.run_id': req.runId, 'sandbox.tier': 'validate' },
        HostConfig: {
          NetworkMode: 'none',
          Memory: this.config.memoryLimitBytes,
          NanoCpus: this.config.cpuLimit * 1e9,
          AutoRemove: true,
          Binds: [
            `${req.modelScriptPath}:/workspace/model.py:ro`,
            // Mount the whole forecasting_agent package (not just evaluation/) --
            // `import forecasting_agent.evaluation` needs the parent package's
            // __init__.py to resolve; evaluation/ alone has no package root.
            `${repoRoot}/src/forecasting_agent:/workspace/m8/forecasting_agent:ro`,
          ],
        },
      });

      const attachStream = await container.attach({ stream: true, stdout: true, stderr: true });
      container.modem.demuxStream(
        attachStream,
        { write: (c: Buffer) => stdout.write(c) },
        { write: (c: Buffer) => stderr.write(c) },
      );

      const runPromise = container.start().then(() => container.wait());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new SandboxTimeoutError(`validate exceeded ${this.config.timeoutMs}ms`)),
          this.config.timeoutMs,
        );
      });

      let waitResult: { StatusCode: number };
      try {
        waitResult = await Promise.race([runPromise, timeoutPromise]);
      } catch (err) {
        if (err instanceof SandboxTimeoutError) {
          await container.kill().catch(() => {});
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }

      const stdoutStr = stdout.toString();
      const resultLine = stdoutStr
        .split('\n')
        .reverse()
        .find((line) => line.startsWith('__EVAL_RESULT__'));

      if (waitResult.StatusCode !== 0) {
        if (resultLine) {
          const payload = JSON.parse(resultLine.slice('__EVAL_RESULT__'.length)) as {
            error?: string;
            detail?: string;
          };
          throw new ValidationFailedError(
            `validate failed: ${payload.error ?? 'unknown'}`,
            payload.detail ?? stdoutStr,
          );
        }
        throw new SandboxError('validate container failed with no result payload', waitResult.StatusCode);
      }

      const evalResult = resultLine
        ? EvalResultSchema.parse(JSON.parse(resultLine.slice('__EVAL_RESULT__'.length)))
        : undefined;

      return {
        stdout: stdoutStr,
        stderr: stderr.toString(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        exitCode: waitResult.StatusCode,
        durationMs: Date.now() - start,
        evalResult,
      };
    });
  }

  // Takes nothing; returns void after force-removing any sandbox.managed containers
  // not present in this fresh instance's warmContainers map (crash/restart orphan cleanup).
  async reconcile(): Promise<void> {
    const listed = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['sandbox.managed=true'] }),
    });
    for (const info of listed) {
      const runId = info.Labels?.['sandbox.run_id'];
      if (runId && this.warmContainers.has(runId)) continue;
      const container = this.docker.getContainer(info.Id);
      await container.remove({ force: true }).catch(() => {});
    }
  }

  // Takes a run_id; returns void after killing+removing that run's warm container, if any.
  async disposeRun(runId: string): Promise<void> {
    const mutex = this.mutexFor(runId);
    await mutex.runExclusive(async () => {
      const entry = this.warmContainers.get(runId);
      if (entry) {
        await entry.container.remove({ force: true }).catch(() => {});
        this.warmContainers.delete(runId);
      }
    });
  }

  // Takes nothing; returns void after stopping the reaper interval (test/process cleanup).
  async shutdown(): Promise<void> {
    clearInterval(this.reaperHandle);
  }

  // Takes a run_id and optional host workspace path; returns its warm container, creating one if absent.
  private async getOrCreateWarmContainer(runId: string, workspacePath?: string): Promise<WarmEntry> {
    const existing = this.warmContainers.get(runId);
    if (existing) return existing;

    const binds = workspacePath ? [`${workspacePath}:/workspace:rw`] : [];
    const container = await this.docker.createContainer({
      Image: 'forecasting-sandbox:latest',
      Cmd: ['tail', '-f', '/dev/null'],
      Labels: { 'sandbox.managed': 'true', 'sandbox.run_id': runId },
      HostConfig: {
        Memory: this.config.memoryLimitBytes,
        NanoCpus: this.config.cpuLimit * 1e9,
        Binds: binds,
      },
    });
    await container.start();
    const entry: WarmEntry = { container, lastActivityMs: Date.now() };
    this.warmContainers.set(runId, entry);
    return entry;
  }

  // Takes a container, code to run, run_id, and explore/validate flag; returns ExecutionResult,
  // racing the exec against the configured timeout and killing+removing on expiry.
  private async execWithTimeout(
    container: Dockerode.Container,
    code: string,
    runId: string,
    isExplore: boolean,
  ): Promise<ExecutionResult> {
    const stdout = new RingBuffer(this.config.stdioBufferBytes);
    const stderr = new RingBuffer(this.config.stdioBufferBytes);
    const start = Date.now();

    const doExec = async () => {
      const writeExec = await container.exec({
        Cmd: ['sh', '-c', 'cat > /tmp/script.py'],
        AttachStdin: true,
      });
      const writeStream = await writeExec.start({ hijack: true, stdin: true });
      if (typeof (writeStream as { end?: (d: string) => void })?.end === 'function') {
        (writeStream as { end: (d: string) => void }).end(code);
      }
      if (typeof (writeStream as { on?: (ev: string, cb: () => void) => void })?.on === 'function') {
        await new Promise<void>((resolve) => {
          (writeStream as { on: (ev: string, cb: () => void) => void }).on('end', resolve);
        });
      }

      const runExec = await container.exec({
        Cmd: ['python', '/tmp/script.py'],
        AttachStdout: true,
        AttachStderr: true,
      });

      const runStream = await runExec.start({ hijack: true, stdin: false });
      if (runStream) {
        // Docker exec streams multiplex stdout/stderr into one stream with an 8-byte
        // frame header per chunk unless Tty is set -- demux, don't read raw chunks,
        // or the captured output contains binary frame headers mixed into the text.
        await new Promise<void>((resolve) => {
          container.modem.demuxStream(
            runStream,
            { write: (c: Buffer) => stdout.write(c) },
            { write: (c: Buffer) => stderr.write(c) },
          );
          runStream.on('end', () => resolve());
        });
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new SandboxTimeoutError(`exec exceeded ${this.config.timeoutMs}ms`)),
        this.config.timeoutMs,
      );
    });

    try {
      await Promise.race([doExec(), timeoutPromise]);
    } catch (err) {
      if (err instanceof SandboxTimeoutError) {
        await container.kill().catch(() => {});
        if (isExplore) {
          await container.remove({ force: true }).catch(() => {});
          this.warmContainers.delete(runId);
        }
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }

    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  }

  // Takes nothing; returns void after killing+removing warm containers idle past idleReaperMs,
  // acquiring each run's mutex first so an in-flight/queued call is never interrupted.
  private async reapIdle(): Promise<void> {
    const now = Date.now();
    for (const [runId, entry] of this.warmContainers.entries()) {
      if (now - entry.lastActivityMs < this.config.idleReaperMs) continue;
      const mutex = this.mutexFor(runId);
      if (mutex.isLocked()) continue; // an in-flight/queued call holds it -- skip this sweep
      await mutex.runExclusive(async () => {
        const current = this.warmContainers.get(runId);
        if (!current) return;
        await current.container.remove({ force: true }).catch(() => {});
        this.warmContainers.delete(runId);
      });
    }
  }
}
