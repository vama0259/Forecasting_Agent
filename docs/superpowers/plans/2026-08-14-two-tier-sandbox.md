# Two-Tier Docker Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `SandboxManager` (harness TS) and the `forecasting-sandbox` Docker image so agent-written Python can run in two isolated tiers — warm/PyPI-enabled `explore` and cold/`--network none` `validate` — per ADR-021/027 (issue #7).

**Architecture:** `harness/src/sandbox/` is a self-contained module: `ring-buffer.ts` (pure, no deps), `types.ts` (Zod schemas + inferred types + error classes), `manager.ts` (`SandboxManager` class wrapping `dockerode`). `sandbox/` at repo root holds the Docker image (`Dockerfile`, `requirements.txt`, `entrypoints/validate.py`) — a separate build artifact, not part of the TS build. No caller exists yet (M7 isn't built) — this issue's boundary is the `SandboxManager` public API and the built image, nothing consumes it yet.

**Tech Stack:** TypeScript (existing `harness/` pnpm project, Node ≥24, vitest), `dockerode` + `@types/dockerode` (new deps), `async-mutex` (new dep, `Mutex` + `Semaphore`), `zod` (already a dep). Python 3.12-slim image, `pydantic>=2.13`, `numpy>=2.5.2` pinned to match `pyproject.toml`.

**Spec:** `docs/superpowers/specs/2026-08-14-two-tier-sandbox-design.md` — cleared 2 consecutive `APPROVED` reviews (5 rounds total, incl. a fresh SDE III pass). This plan implements it task-by-task; read both.

## Global Constraints

- **45s hard timeout** per container exec, both tiers (spec §5).
- **50KB circular buffer** on stdout and stderr independently, both tiers (spec §5).
- **Semaphore(2)** — max 2 concurrent container executions across both tiers combined (spec §5).
- **`--memory=512m --cpus=1`** cgroup caps on every container, both tiers (spec §5).
- **Validate tier is `--network none`, always fresh (`--rm`), never mounts anything writable** — no output bind mount exists; results cross the boundary via stdout only (spec §3).
- **Explore never `docker exec -c <code>`** — code is written into the container via a piped stdin exec, then executed as a file, to avoid argv/shell escaping (spec §3, round-4 fix).
- **Per-`run_id` `Mutex`, acquired before the container handle is resolved** — both `runExplore()` and the idle reaper must hold it; this is what makes the warm-container map race-free (spec §3, round-4 fix).
- **All new files carry the repo's one-line-abstract + one-line-per-function comment convention** (project `CLAUDE.md` Code Style section) — every `.ts` file gets a top-of-file abstract; every exported function/class method gets a one-line input/output comment.
- Node/TS commands run via `pnpm` from `harness/`; Python/Docker commands run from repo root.

---

## File Structure

```
harness/src/sandbox/
  ring-buffer.ts        -- RingBuffer: fixed-capacity circular byte buffer (Task 1)
  types.ts               -- Zod schemas, inferred types, error classes (Task 2)
  manager.ts              -- SandboxManager class (Tasks 3-7)
harness/tests/sandbox/
  ring-buffer.test.ts
  types.test.ts
  manager-concurrency.test.ts   -- semaphore, per-run mutex, reaper-vs-mutex race (mocked dockerode)
  manager-timeout.test.ts       -- 45s timeout kill+remove (mocked dockerode)
  manager-explore.test.ts       -- real Docker, tagged skip-if-no-docker
  manager-validate.test.ts      -- real Docker, tagged skip-if-no-docker
sandbox/
  Dockerfile
  requirements.txt
  entrypoints/
    validate.py
  tests/
    test_validate_entrypoint.py   -- pytest, no Docker needed (tests validate.py's logic directly)
```

---

## Task 1: RingBuffer

**Files:**
- Create: `harness/src/sandbox/ring-buffer.ts`
- Test: `harness/tests/sandbox/ring-buffer.test.ts`

**Interfaces:**
- Consumes: nothing (pure, zero dependencies)
- Produces: `class RingBuffer { constructor(capacityBytes: number); write(chunk: Buffer | string): void; toString(): string; get truncated(): boolean; get sizeBytes(): number; }` — used by `manager.ts` in Task 4 onward.

**Seam note:** This is the one piece of the module with no Docker dependency at all — pure byte-buffer logic. Gemini can implement and fully verify this task with zero mocking.

- [ ] **Step 1: Write the failing test**

```ts
// harness/tests/sandbox/ring-buffer.test.ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/sandbox/ring-buffer.js';

describe('RingBuffer', () => {
  it('returns full content and truncated=false when under capacity', () => {
    const rb = new RingBuffer(1024);
    rb.write('hello ');
    rb.write('world');
    expect(rb.toString()).toBe('hello world');
    expect(rb.truncated).toBe(false);
    expect(rb.sizeBytes).toBe(11);
  });

  it('truncates and drops oldest bytes on overflow, keeping exactly capacity bytes', () => {
    const rb = new RingBuffer(10);
    rb.write('0123456789'); // exactly 10 bytes, fills buffer
    rb.write('ABC'); // 3 more bytes -> must drop oldest 3 ("012")
    expect(rb.toString()).toBe('3456789ABC');
    expect(rb.truncated).toBe(true);
    expect(rb.sizeBytes).toBe(10);
  });

  it('handles a single write larger than capacity by keeping only the tail', () => {
    const rb = new RingBuffer(5);
    rb.write('0123456789'); // 10 bytes in one write, capacity 5
    expect(rb.toString()).toBe('56789');
    expect(rb.truncated).toBe(true);
  });

  it('accepts Buffer chunks as well as strings', () => {
    const rb = new RingBuffer(1024);
    rb.write(Buffer.from('binary-safe'));
    expect(rb.toString()).toBe('binary-safe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `harness/`): `pnpm vitest run tests/sandbox/ring-buffer.test.ts`
Expected: FAIL — `Cannot find module '../../src/sandbox/ring-buffer.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// harness/src/sandbox/ring-buffer.ts
// Fixed-capacity circular byte buffer: appends chunks, silently drops the oldest
// bytes on overflow, and flags when any drop has occurred.

export class RingBuffer {
  private readonly capacity: number;
  private buf: Buffer;
  private didTruncate = false;

  // Takes buffer capacity in bytes; returns a RingBuffer starting empty.
  constructor(capacityBytes: number) {
    this.capacity = capacityBytes;
    this.buf = Buffer.alloc(0);
  }

  // Takes a chunk (string or Buffer); appends it, dropping oldest bytes past capacity.
  write(chunk: Buffer | string): void {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    const combined = Buffer.concat([this.buf, incoming]);
    if (combined.length > this.capacity) {
      this.buf = combined.subarray(combined.length - this.capacity);
      this.didTruncate = true;
    } else {
      this.buf = combined;
    }
  }

  // Takes nothing; returns the buffered content decoded as UTF-8.
  toString(): string {
    return this.buf.toString('utf8');
  }

  // Takes nothing; returns whether any write has ever caused a drop.
  get truncated(): boolean {
    return this.didTruncate;
  }

  // Takes nothing; returns current buffered size in bytes.
  get sizeBytes(): number {
    return this.buf.length;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/sandbox/ring-buffer.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add harness/src/sandbox/ring-buffer.ts harness/tests/sandbox/ring-buffer.test.ts
git commit -m "feat(sandbox): add RingBuffer for 50KB stdout/stderr capping"
```

---

## Task 2: Types, Zod schemas, error classes

**Files:**
- Create: `harness/src/sandbox/types.ts`
- Test: `harness/tests/sandbox/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by `manager.ts` from Task 3 onward):
  - `type SandboxTier = 'explore' | 'validate'`
  - `const ExecutionRequestSchema: z.ZodType`, `type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>` — fields: `runId: string`, `tier: SandboxTier`, `code?: string`, `workspacePath?: string`, `modelScriptPath?: string`
  - `const EvalResultSchema: z.ZodType`, `type EvalResult = z.infer<typeof EvalResultSchema>` — mirrors M8's `EvalResult` shape: `{ verdict: unknown; layers: unknown[]; layer_means: Record<string, unknown> }` (kept loose/`z.unknown()` at the leaf level deliberately — M8's Pydantic `GateVerdict`/`LayerScore`/`LayerMean` internals are Python-side and out of scope for this TS module to fully re-type; the point of this schema is to reject a malformed top-level shape, not to duplicate M8's full type system)
  - `interface ExecutionResult { stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean; exitCode: number; durationMs: number; evalResult?: EvalResult }`
  - `interface SandboxConfig { concurrency?: number; timeoutMs?: number; stdioBufferBytes?: number; idleReaperMs?: number; memoryLimitBytes?: number; cpuLimit?: number }`
  - `class SandboxTimeoutError extends Error {}`
  - `class ValidationFailedError extends Error { readonly detail: string; constructor(message: string, detail: string) }`
  - `class SandboxError extends Error { readonly exitCode?: number; constructor(message: string, exitCode?: number) }`

**Seam note:** Pure types/schemas, no Docker. `ExecutionRequestSchema` is the validation boundary `manager.ts` calls at the top of `runExplore`/`runValidate` (spec §4: "Zod schemas mirror these for runtime validation at the SandboxManager public boundary").

- [ ] **Step 1: Write the failing test**

```ts
// harness/tests/sandbox/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  ExecutionRequestSchema,
  EvalResultSchema,
  SandboxTimeoutError,
  ValidationFailedError,
  SandboxError,
} from '../../src/sandbox/types.js';

describe('ExecutionRequestSchema', () => {
  it('accepts a valid explore request', () => {
    const parsed = ExecutionRequestSchema.parse({
      runId: 'run-1',
      tier: 'explore',
      code: 'print(1)',
    });
    expect(parsed.tier).toBe('explore');
  });

  it('accepts a valid validate request', () => {
    const parsed = ExecutionRequestSchema.parse({
      runId: 'run-1',
      tier: 'validate',
      modelScriptPath: '/tmp/model.py',
    });
    expect(parsed.tier).toBe('validate');
  });

  it('rejects a request with an invalid tier', () => {
    expect(() =>
      ExecutionRequestSchema.parse({ runId: 'run-1', tier: 'bogus' }),
    ).toThrow();
  });

  it('rejects a request missing runId', () => {
    expect(() => ExecutionRequestSchema.parse({ tier: 'explore', code: 'x' })).toThrow();
  });
});

describe('EvalResultSchema', () => {
  it('accepts a well-formed EvalResult shape', () => {
    const parsed = EvalResultSchema.parse({
      verdict: { status: 'VALID' },
      layers: [{ layer: 1, fold_number: 0, value: 0.5 }],
      layer_means: { '1': { mean: 0.5, n_folds: 2 } },
    });
    expect(parsed.layers).toHaveLength(1);
  });

  it('rejects a shape missing required top-level keys', () => {
    expect(() => EvalResultSchema.parse({ verdict: {} })).toThrow();
  });
});

describe('error classes', () => {
  it('SandboxTimeoutError is a distinct Error subclass', () => {
    const e = new SandboxTimeoutError('timed out');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('timed out');
  });

  it('ValidationFailedError carries a detail string separate from message', () => {
    const e = new ValidationFailedError('model failed', 'ImportError: no module neuralforecast');
    expect(e.detail).toContain('ImportError');
  });

  it('SandboxError optionally carries the container exit code', () => {
    const e = new SandboxError('OOM killed', 137);
    expect(e.exitCode).toBe(137);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/sandbox/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// harness/src/sandbox/types.ts
// Zod schemas, inferred types, and error classes for the sandbox module's public boundary.

import { z } from 'zod';

// Validates the shape of any call into SandboxManager.runExplore/runValidate.
export const ExecutionRequestSchema = z.object({
  runId: z.string().min(1),
  tier: z.enum(['explore', 'validate']),
  code: z.string().optional(),
  workspacePath: z.string().optional(),
  modelScriptPath: z.string().optional(),
});
export type SandboxTier = z.infer<typeof ExecutionRequestSchema>['tier'];
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

// Validates the top-level shape of M8's EvalResult JSON echoed from validate.py's stdout.
export const EvalResultSchema = z.object({
  verdict: z.unknown(),
  layers: z.array(z.unknown()),
  layer_means: z.record(z.string(), z.unknown()),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number;
  durationMs: number;
  evalResult?: EvalResult;
}

export interface SandboxConfig {
  concurrency?: number;
  timeoutMs?: number;
  stdioBufferBytes?: number;
  idleReaperMs?: number;
  memoryLimitBytes?: number;
  cpuLimit?: number;
}

// Thrown when a container exec exceeds the configured hard timeout.
export class SandboxTimeoutError extends Error {}

// Thrown when the validate tier's model/M8 pipeline fails on its own terms (not an infra failure).
export class ValidationFailedError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

// Thrown for generic Docker/infra failures (daemon unreachable, OOM kill, etc.).
export class SandboxError extends Error {
  readonly exitCode?: number;
  constructor(message: string, exitCode?: number) {
    super(message);
    this.exitCode = exitCode;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/sandbox/types.test.ts`
Expected: PASS, 8/8

- [ ] **Step 5: Commit**

```bash
git add harness/src/sandbox/types.ts harness/tests/sandbox/types.test.ts
git commit -m "feat(sandbox): add types, Zod schemas, and error classes"
```

---

## Task 3: Add dependencies

**Files:**
- Modify: `harness/package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `dockerode`, `@types/dockerode`, `async-mutex` importable from Task 4 onward.

**Seam note:** Pure dependency addition — no code. Do this as its own commit so a `pnpm install` failure is isolated from logic changes.

- [ ] **Step 1: Add dependencies**

```bash
cd harness
pnpm add dockerode@^5.0.1 async-mutex@^0.5.0
pnpm add -D @types/dockerode@^4.0.1
```

- [ ] **Step 2: Verify install succeeded**

Run: `pnpm list dockerode async-mutex @types/dockerode`
Expected: all three listed with the versions above, no errors.

- [ ] **Step 3: Commit**

```bash
git add harness/package.json harness/pnpm-lock.yaml
git commit -m "chore(sandbox): add dockerode and async-mutex dependencies"
```

---

## Task 4: SandboxManager skeleton — Semaphore, per-run Mutex, timeout (mocked dockerode)

**Files:**
- Create: `harness/src/sandbox/manager.ts`
- Test: `harness/tests/sandbox/manager-concurrency.test.ts`
- Test: `harness/tests/sandbox/manager-timeout.test.ts`

**Interfaces:**
- Consumes: `RingBuffer` (Task 1), `ExecutionRequestSchema`/`ExecutionResult`/`SandboxConfig`/error classes (Task 2), `dockerode`/`async-mutex` (Task 3)
- Produces: `class SandboxManager { constructor(config?: SandboxConfig); runExplore(req: ExecutionRequest): Promise<ExecutionResult>; runValidate(req: ExecutionRequest): Promise<ExecutionResult>; disposeRun(runId: string): Promise<void>; shutdown(): Promise<void>; }` — `runValidate`'s real Docker logic lands in Task 6; this task stubs it to throw `Error('not implemented')` so `runExplore`'s concurrency primitives can be tested in isolation first.

**Seam note:** This is the concurrency-critical task. Everything here is testable **without a real Docker daemon** by injecting a mock `dockerode.Docker` instance — the constructor must accept an optional second parameter `dockerImpl?: Dockerode` (defaulting to `new Dockerode()`) purely so tests can substitute a fake. Implements: Semaphore(2), per-`run_id` Mutex acquired *before* the container handle is resolved, 45s timeout via `Promise.race`, and the reaper-vs-mutex race fix (spec §3: reaper acquires the same per-run mutex before killing).

- [ ] **Step 1: Write the failing tests**

```ts
// harness/tests/sandbox/manager-concurrency.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/sandbox/manager.js';

function makeMockDocker(execDelayMs: number) {
  const execCalls: string[] = [];
  const fakeExec = {
    start: vi.fn(async () => {
      execCalls.push('start');
      await new Promise((r) => setTimeout(r, execDelayMs));
      return {
        on: (_event: string, cb: (...args: unknown[]) => void) => {
          if (_event === 'end') setTimeout(cb, 0);
        },
      };
    }),
  };
  const fakeContainer = {
    id: 'fake-container-id',
    exec: vi.fn(async () => fakeExec),
    inspect: vi.fn(async () => ({ State: { Running: true } })),
    kill: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const fakeDocker = {
    createContainer: vi.fn(async () => fakeContainer),
    listContainers: vi.fn(async () => []),
  };
  return { fakeDocker, fakeContainer, execCalls };
}

describe('SandboxManager concurrency', () => {
  it('blocks a 3rd concurrent runExplore call until one of the first two releases', async () => {
    const { fakeDocker } = makeMockDocker(50);
    const mgr = new SandboxManager({ concurrency: 2 }, fakeDocker as never);

    const order: number[] = [];
    const call = (n: number, runId: string) =>
      mgr
        .runExplore({ runId, tier: 'explore', code: 'print(1)' })
        .then(() => order.push(n));

    await Promise.all([call(1, 'run-a'), call(2, 'run-b'), call(3, 'run-c')]);
    // All 3 must complete; the semaphore only delays, never drops.
    expect(order.sort()).toEqual([1, 2, 3]);
  });

  it('serializes two concurrent runExplore calls for the SAME run_id (per-run mutex)', async () => {
    const { fakeDocker } = makeMockDocker(30);
    const mgr = new SandboxManager({ concurrency: 2 }, fakeDocker as never);

    const timestamps: number[] = [];
    const call = () =>
      mgr.runExplore({ runId: 'shared-run', tier: 'explore', code: 'print(1)' }).then(() => {
        timestamps.push(Date.now());
      });

    const start = Date.now();
    await Promise.all([call(), call()]);
    // If serialized, the second call cannot finish before ~2x the exec delay has elapsed.
    expect(timestamps[1] - start).toBeGreaterThanOrEqual(55);
  });
});
```

```ts
// harness/tests/sandbox/manager-timeout.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { SandboxTimeoutError } from '../../src/sandbox/types.js';

function makeSlowMockDocker() {
  const fakeContainer = {
    id: 'fake-container-id',
    exec: vi.fn(async () => ({
      start: vi.fn(async () => ({
        on: (_event: string, _cb: (...args: unknown[]) => void) => {
          // never calls back "end" -- simulates a hang past the timeout
        },
      })),
    })),
    inspect: vi.fn(async () => ({ State: { Running: true } })),
    kill: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
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

    await expect(
      mgr.runExplore({ runId: 'run-timeout', tier: 'explore', code: 'while True: pass' }),
    ).rejects.toThrow(SandboxTimeoutError);

    expect(fakeContainer.kill).toHaveBeenCalled();
    expect(fakeContainer.remove).toHaveBeenCalled();
  });

  it('idle reaper does not kill a container whose per-run mutex is currently held', async () => {
    const { fakeDocker, fakeContainer } = makeSlowMockDocker();
    const mgr = new SandboxManager(
      { concurrency: 2, timeoutMs: 5000, idleReaperMs: 10 },
      fakeDocker as never,
    );
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/sandbox/manager-concurrency.test.ts tests/sandbox/manager-timeout.test.ts`
Expected: FAIL — module not found (`manager.ts` doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```ts
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
  SandboxError,
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
    this.reaperHandle = setInterval(() => this.reapIdle(), this.config.idleReaperMs);
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
  private async getOrCreateWarmContainer(
    runId: string,
    workspacePath?: string,
  ): Promise<WarmEntry> {
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

    const writeExec = await container.exec({
      Cmd: ['sh', '-c', 'cat > /tmp/script.py'],
      AttachStdin: true,
    });
    const writeStream = await writeExec.start({ hijack: true, stdin: true });
    writeStream.end(code);
    await new Promise((resolve) => writeStream.on('end', resolve));

    const runExec = await container.exec({
      Cmd: ['python', '/tmp/script.py'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const execPromise = new Promise<void>((resolve) => {
      runExec.start({}, (_err, stream) => {
        if (!stream) return resolve();
        stream.on('data', (chunk: Buffer) => stdout.write(chunk));
        stream.on('end', resolve);
      });
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new SandboxTimeoutError(`exec exceeded ${this.config.timeoutMs}ms`)), this.config.timeoutMs);
    });

    try {
      await Promise.race([execPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof SandboxTimeoutError) {
        await container.kill().catch(() => {});
        if (isExplore) {
          await container.remove({ force: true }).catch(() => {});
          this.warmContainers.delete(runId);
        }
      }
      throw err;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/sandbox/manager-concurrency.test.ts tests/sandbox/manager-timeout.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add harness/src/sandbox/manager.ts harness/tests/sandbox/manager-concurrency.test.ts harness/tests/sandbox/manager-timeout.test.ts
git commit -m "feat(sandbox): add SandboxManager explore tier with Semaphore/mutex/timeout"
```

---

## Task 5: Docker image (Dockerfile, requirements.txt)

**Files:**
- Create: `sandbox/Dockerfile`
- Create: `sandbox/requirements.txt`

**Interfaces:**
- Consumes: nothing
- Produces: image tag `forecasting-sandbox:latest`, consumed by Task 4's `createContainer({ Image: 'forecasting-sandbox:latest', ... })` and Task 6/7's validate `docker run`.

**Seam note:** No TS/test cycle here — this is a build artifact. "Testable deliverable" for this task is `docker build` succeeding and `docker run forecasting-sandbox:latest python -c "import pandas, numpy, pydantic; print('ok')"` printing `ok`.

- [ ] **Step 1: Write requirements.txt**

```
# sandbox/requirements.txt
# Pinned to match pyproject.toml so M8's EvalRequest/evaluate() behave identically
# inside the sandbox as outside it (spec section 6).
numpy==2.5.2
pydantic==2.13.0
pandas==2.2.3
scipy==1.14.1
statsmodels==0.14.4
scikit-learn==1.5.2
prophet==1.1.6
xgboost==2.1.3
lightgbm==4.5.0
pmdarima==2.0.4
arch==7.2.0
ta==0.11.0
```

- [ ] **Step 2: Write Dockerfile**

```dockerfile
# sandbox/Dockerfile
FROM python:3.12-slim

RUN useradd --create-home --uid 1000 agent

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

RUN mkdir -p /workspace /entrypoints && chown -R agent:agent /workspace /entrypoints
COPY entrypoints/validate.py /entrypoints/validate.py

USER agent
WORKDIR /workspace
```

- [ ] **Step 3: Build and smoke-test the image**

Run (from repo root):
```bash
docker build -f sandbox/Dockerfile -t forecasting-sandbox:latest sandbox/
docker run --rm forecasting-sandbox:latest python -c "import pandas, numpy, pydantic, sklearn; print('ok')"
```
Expected: image builds without error; final line prints `ok`.

Note: `entrypoints/validate.py` doesn't exist until Task 6 — this build will fail on the `COPY entrypoints/validate.py` line until Task 6 lands. Either stub an empty `sandbox/entrypoints/validate.py` in this task (`touch`) so the build succeeds standalone, or land Task 5 and Task 6 as one combined commit. Recommended: stub it now, replace in Task 6.

```bash
mkdir -p sandbox/entrypoints
touch sandbox/entrypoints/validate.py
```

- [ ] **Step 4: Commit**

```bash
git add sandbox/Dockerfile sandbox/requirements.txt sandbox/entrypoints/validate.py
git commit -m "feat(sandbox): add forecasting-sandbox Docker image"
```

---

## Task 6: validate.py entrypoint

**Files:**
- Create: `sandbox/entrypoints/validate.py` (replaces the Task 5 stub)
- Test: `sandbox/tests/test_validate_entrypoint.py`

**Interfaces:**
- Consumes: `forecasting_agent.evaluation.evaluate`, `EvalRequest` (from M8, `src/forecasting_agent/evaluation/`, mounted read-only at `/workspace/m8/evaluation` inside the validate container per spec §3 — but for this task's unit tests, run directly against the repo's `src/` on `PYTHONPATH`, no Docker needed)
- Produces: a script that (1) subprocess-runs `/workspace/model.py`, expecting it to write `/tmp/eval_request.json`; (2) loads that JSON into `EvalRequest`; (3) calls `evaluate()`; (4) prints `__EVAL_RESULT__<json>` to stdout on success, or `__EVAL_RESULT__{"error": "...", "detail": "..."}` and exits non-zero on failure.

**Seam note:** This is the "never arbitrary code" boundary (spec §3) — the only thing ever exec'd in the validate tier. Testable standalone with `pytest`, no Docker: point `PYTHONPATH` at the repo root and fabricate a fake `/workspace/model.py` that writes a known `eval_request.json`.

- [ ] **Step 1: Write the failing test**

```python
# sandbox/tests/test_validate_entrypoint.py
import json
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = REPO_ROOT / "sandbox" / "entrypoints" / "validate.py"

VALID_MODEL_SCRIPT = textwrap.dedent(
    """
    import json
    request = {
        "returns": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
        "forecasts": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
        "calls": [0.6, 0.4, 0.6, 0.55, 0.4, 0.65, 0.6, 0.45, 0.6, 0.5],
        "timestamps": [f"2024-01-{i+1:02d}T00:00:00+00:00" for i in range(10)],
        "as_of": "2024-01-11T00:00:00+00:00",
        "segment": "EQUITY_DELIVERY",
        "position_notional": [1000.0] * 10,
        "trade_side": ["buy"] * 10,
        "capital": 100000.0,
    }
    with open("/tmp/eval_request.json", "w") as f:
        json.dump(request, f)
    """
)

CRASHING_MODEL_SCRIPT = "raise RuntimeError('boom')"


def run_entrypoint(model_script_body: str, tmp_path: Path) -> subprocess.CompletedProcess:
    model_path = tmp_path / "model.py"
    model_path.write_text(model_script_body)
    env = {"PYTHONPATH": str(REPO_ROOT / "src"), "MODEL_SCRIPT_PATH": str(model_path)}
    return subprocess.run(
        [sys.executable, str(ENTRYPOINT)],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def test_valid_model_produces_eval_result(tmp_path):
    result = run_entrypoint(VALID_MODEL_SCRIPT, tmp_path)
    assert result.returncode == 0, result.stderr
    line = [ln for ln in result.stdout.splitlines() if ln.startswith("__EVAL_RESULT__")][-1]
    payload = json.loads(line[len("__EVAL_RESULT__") :])
    assert "verdict" in payload
    assert "layers" in payload


def test_crashing_model_exits_nonzero_with_error_payload(tmp_path):
    result = run_entrypoint(CRASHING_MODEL_SCRIPT, tmp_path)
    assert result.returncode != 0
    line = [ln for ln in result.stdout.splitlines() if ln.startswith("__EVAL_RESULT__")][-1]
    payload = json.loads(line[len("__EVAL_RESULT__") :])
    assert "error" in payload
    assert "boom" in payload["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `uv run pytest sandbox/tests/test_validate_entrypoint.py -v`
Expected: FAIL — `validate.py` is currently an empty stub, produces no `__EVAL_RESULT__` line.

- [ ] **Step 3: Write minimal implementation**

```python
# sandbox/entrypoints/validate.py
"""Fixed validate-tier entrypoint: runs the submitted model script, feeds its output
through M8's evaluate(), and prints the result as a single delimited stdout line.
Never executes anything other than this fixed sequence -- the model script's content
is arbitrary, but this script's own control flow is not."""

import json
import os
import subprocess
import sys

RESULT_PREFIX = "__EVAL_RESULT__"


def main() -> int:
    """Takes no arguments (reads MODEL_SCRIPT_PATH env var); returns process exit code."""
    model_script_path = os.environ.get("MODEL_SCRIPT_PATH", "/workspace/model.py")
    request_path = "/tmp/eval_request.json"

    try:
        proc = subprocess.run(
            [sys.executable, model_script_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"model script exited {proc.returncode}: {proc.stderr}")

        with open(request_path) as f:
            request_json = json.load(f)

        from forecasting_agent.evaluation import EvalRequest, evaluate

        request = EvalRequest.model_validate(request_json)
        result = evaluate(request)
        print(RESULT_PREFIX + result.model_dump_json())
        return 0
    except Exception as exc:  # noqa: BLE001 -- intentional catch-all at this boundary
        payload = {"error": type(exc).__name__, "detail": str(exc)}
        print(RESULT_PREFIX + json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest sandbox/tests/test_validate_entrypoint.py -v`
Expected: PASS, 2/2

- [ ] **Step 5: Rebuild the Docker image with the real entrypoint and re-run the Task 5 smoke test**

```bash
docker build -f sandbox/Dockerfile -t forecasting-sandbox:latest sandbox/
docker run --rm forecasting-sandbox:latest python -c "import pandas, numpy, pydantic, sklearn; print('ok')"
```
Expected: still prints `ok` — confirms the real entrypoint doesn't break the image build.

- [ ] **Step 6: Commit**

```bash
git add sandbox/entrypoints/validate.py sandbox/tests/test_validate_entrypoint.py
git commit -m "feat(sandbox): add validate.py entrypoint invoking M8 evaluate()"
```

---

## Task 7: SandboxManager validate tier (real dockerode, `--network none`)

**Files:**
- Modify: `harness/src/sandbox/manager.ts` (implement `runValidate`, replacing the Task 4 stub)
- Test: `harness/tests/sandbox/manager-validate.test.ts` (Docker-gated, see Step 0)

**Interfaces:**
- Consumes: everything from Tasks 1-6, plus the built `forecasting-sandbox:latest` image and `sandbox/entrypoints/validate.py`'s `__EVAL_RESULT__`-delimited stdout contract.
- Produces: working `SandboxManager.runValidate(req: ExecutionRequest): Promise<ExecutionResult>` with `evalResult` populated on success, throwing `ValidationFailedError` on a non-zero exit whose stdout contains an `__EVAL_RESULT__` error payload, or `SandboxError` for any other non-zero exit (e.g. OOM kill 137).

**Seam note:** This is the only task that needs a real Docker daemon to verify meaningfully (a `--network none` container's *actual* network isolation can't be honestly asserted against a mock). Gate this test file so `pnpm test` doesn't fail in a Docker-less CI runner — mirror `storage-integration.test.ts`'s pattern of checking an env var / trying a real connection in `beforeAll` and skipping via `describe.skipIf`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/tests/sandbox/manager-validate.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { ValidationFailedError } from '../../src/sandbox/types.js';

let dockerAvailable = true;
beforeAll(() => {
  try {
    execSync('docker info', { stdio: 'ignore' });
  } catch {
    dockerAvailable = false;
  }
});

const VALID_MODEL_SCRIPT = `
import json
request = {
    "returns": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
    "forecasts": [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.01, -0.005, 0.015, 0.0],
    "calls": [0.6, 0.4, 0.6, 0.55, 0.4, 0.65, 0.6, 0.45, 0.6, 0.5],
    "timestamps": [f"2024-01-{i+1:02d}T00:00:00+00:00" for i in range(10)],
    "as_of": "2024-01-11T00:00:00+00:00",
    "segment": "EQUITY_DELIVERY",
    "position_notional": [1000.0] * 10,
    "trade_side": ["buy"] * 10,
    "capital": 100000.0,
}
with open("/tmp/eval_request.json", "w") as f:
    json.dump(request, f)
`;

const UNAPPROVED_IMPORT_SCRIPT = `
import neuralforecast  # not in the pinned image, and no network to pip install it
`;

describe.skipIf(!dockerAvailable)('SandboxManager.runValidate (requires Docker)', () => {
  it('runs a valid model script and returns a matching EvalResult', async () => {
    const mgr = new SandboxManager();
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-validate-'));
    const modelPath = join(dir, 'model.py');
    writeFileSync(modelPath, VALID_MODEL_SCRIPT);

    const result = await mgr.runValidate({
      runId: 'validate-run-1',
      tier: 'validate',
      modelScriptPath: modelPath,
    });

    expect(result.evalResult).toBeDefined();
    expect(result.evalResult?.verdict).toBeDefined();
    await mgr.shutdown();
  });

  it('rejects a script importing an unapproved package as ValidationFailedError', async () => {
    const mgr = new SandboxManager();
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-validate-'));
    const modelPath = join(dir, 'model.py');
    writeFileSync(modelPath, UNAPPROVED_IMPORT_SCRIPT);

    await expect(
      mgr.runValidate({ runId: 'validate-run-2', tier: 'validate', modelScriptPath: modelPath }),
    ).rejects.toThrow(ValidationFailedError);
    await mgr.shutdown();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `harness/`, with Docker running): `pnpm vitest run tests/sandbox/manager-validate.test.ts`
Expected: FAIL — `runValidate` still throws `Error('not implemented')` from Task 4's stub.

- [ ] **Step 3: Implement `runValidate` in `manager.ts`**

Replace the Task 4 stub:

```ts
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
      const repoRoot = process.cwd();

      const container = await this.docker.createContainer({
        Image: 'forecasting-sandbox:latest',
        Cmd: ['python', '/entrypoints/validate.py'],
        Env: [`MODEL_SCRIPT_PATH=/workspace/model.py`],
        Labels: { 'sandbox.managed': 'true', 'sandbox.run_id': req.runId, 'sandbox.tier': 'validate' },
        HostConfig: {
          NetworkMode: 'none',
          Memory: this.config.memoryLimitBytes,
          NanoCpus: this.config.cpuLimit * 1e9,
          AutoRemove: true,
          Binds: [
            `${req.modelScriptPath}:/workspace/model.py:ro`,
            `${repoRoot}/src/forecasting_agent/evaluation:/workspace/m8/evaluation:ro`,
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
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        setTimeout(
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
      }

      const stdoutStr = stdout.toString();
      const resultLine = stdoutStr
        .split('\n')
        .reverse()
        .find((line) => line.startsWith('__EVAL_RESULT__'));

      if (waitResult.StatusCode !== 0) {
        if (resultLine) {
          const payload = JSON.parse(resultLine.slice('__EVAL_RESULT__'.length));
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
```

Add `EvalResultSchema` and `ValidationFailedError` to the import from `./types.js` at the top of `manager.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/sandbox/manager-validate.test.ts`
Expected: PASS, 2/2 (requires the image built in Task 6 and a running Docker daemon)

- [ ] **Step 5: Run the full sandbox test suite**

Run: `pnpm vitest run tests/sandbox/`
Expected: all tests across Tasks 1, 2, 4, and 7 pass.

- [ ] **Step 6: Commit**

```bash
git add harness/src/sandbox/manager.ts harness/tests/sandbox/manager-validate.test.ts
git commit -m "feat(sandbox): implement validate tier with --network none isolation"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** Semaphore(2) → Task 4. Per-run mutex + reaper race fix → Task 4. 45s timeout → Task 4 (explore), Task 7 (validate). 50KB ring buffer → Task 1, wired in Tasks 4 & 7. Cgroups → Tasks 4 & 7 (`HostConfig.Memory`/`NanoCpus`). Docker image + pinned packages → Task 5. `validate.py` fixed entrypoint, never-arbitrary-code, `__EVAL_RESULT__` stdout contract → Task 6. `--network none`, no output mount → Task 7. Restart-reconciliation labels (`sandbox.managed`, `sandbox.run_id`) → applied in Task 4's `createContainer` and Task 7's; the reconciliation *sweep on startup* itself is not implemented as a standalone task above — **gap, add as Task 8 below** if this plan is executed as-is before that's filled in.
- **Type consistency:** `ExecutionRequest`/`ExecutionResult`/`SandboxConfig`/error classes match between Task 2's definitions and every later task's usage.

## Task 8 (gap closed): Startup reconciliation

**Files:**
- Modify: `harness/src/sandbox/manager.ts`
- Test: `harness/tests/sandbox/manager-reconciliation.test.ts`

**Interfaces:**
- Consumes: `docker.listContainers` (already mocked in Task 4's tests via `fakeDocker.listContainers`)
- Produces: a new async method `SandboxManager.reconcile(): Promise<void>` — call it once after construction (document that the caller, eventually M7, must `await mgr.reconcile()` before first use; `SandboxManager` cannot safely call async work from its own constructor).

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/sandbox/manager-reconciliation.test.ts`
Expected: FAIL — `reconcile` is not a function.

- [ ] **Step 3: Implement `reconcile()` in `manager.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/sandbox/manager-reconciliation.test.ts`
Expected: PASS, 1/1

- [ ] **Step 5: Commit**

```bash
git add harness/src/sandbox/manager.ts harness/tests/sandbox/manager-reconciliation.test.ts
git commit -m "feat(sandbox): add startup reconciliation for orphaned warm containers"
```
