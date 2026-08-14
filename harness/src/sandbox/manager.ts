// harness/src/sandbox/manager.ts
// SandboxManager: owns explore (warm, PyPI) and validate (cold, --network none) container
// execution per ADR-021/027, enforcing Semaphore(2), 45s timeout, and 50KB stdout/stderr caps.

import Dockerode from 'dockerode';
import { Mutex, Semaphore } from 'async-mutex';
import { RingBuffer } from './ring-buffer.js';
import {
  ExecutionRequestSchema,
  type ExecutionRequest,
  type ExecutionResult,
  type SandboxConfig,
  SandboxTimeoutError,
} from './types.js';

const DEFAULTS: Required<SandboxConfig> = {
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

// Owns warm/cold container lifecycle and enforces ADR-021's concurrency/timeout/buffer limits.
export class SandboxManager {
  private readonly config: Required<SandboxConfig>;
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

  // Takes a validate ExecutionRequest; returns its ExecutionResult. Implemented in Task 6.
  async runValidate(_reqInput: ExecutionRequest): Promise<ExecutionResult> {
    void _reqInput;
    throw new Error('not implemented');
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

      const runStream = (await runExec.start({ hijack: true, stdin: false })) as
        { on: (ev: string, cb: (...args: unknown[]) => void) => void } | undefined;
      if (runStream && typeof runStream.on === 'function') {
        await new Promise<void>((resolve) => {
          runStream.on('data', (chunk: unknown) => stdout.write(chunk as Buffer));
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
