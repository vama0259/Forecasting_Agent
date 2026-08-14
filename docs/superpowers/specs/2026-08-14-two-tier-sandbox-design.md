---
type: adr
date: 2026-08-14
status: proposed
parent: "[[Forecasting Agent]]"
---

# Two-Tier Docker Sandbox — Design Spec

**Issue:** #7 (Story 4) · **ADRs:** ADR-021 (lifecycle/network/workspace), ADR-027 §5 (zero-trust isolation) · **Depends on:** #6 (M8, merged to `origin/main` at `03960e0`)

## 1. Purpose

Execute agent-written Python modeling code safely across two execution contexts with opposite requirements:

- **Explore** — dozens of iterations per run, speed critical, state bleed harmless, PyPI access needed for self-extension.
- **Validate** — once per run, speed irrelevant, state bleed **fatal** (must catch residue dependence), no network, M8 mounted read-only.

Runtime enforcement of ADR-012's integrity boundary: a model that only works because of accumulated warm-container state fails validate, with a clear diagnostic, before it ever enters evaluation history.

## 2. Components

```
harness/src/sandbox/
  types.ts          -- SandboxTier, ExecutionRequest, ExecutionResult, SandboxConfig, SandboxError
  ring-buffer.ts     -- RingBuffer: fixed-capacity byte buffer, overwrites oldest on overflow
  manager.ts         -- SandboxManager: runExplore(), runValidate(), dispose()
sandbox/
  Dockerfile          -- python:3.12-slim + ~40 pinned ML packages, non-root uid 1000 "agent"
  requirements.txt    -- pinned versions
  entrypoints/
    validate.py        -- fixed entrypoint baked into image; imports M8, never arbitrary code
```

`SandboxManager` depends on `dockerode` (new dependency) as the Docker Engine API client — typed container lifecycle (create/start/exec/kill/remove), mockable in unit tests, no shell-escaping risk.

## 3. Data flow

### Explore (warm, stateful)
```
runExplore({ runId, code, workspacePath })
  -> acquire Semaphore(2) permit
  -> container = warmContainers.get(runId) ?? createWarmContainer(runId)
  -> docker exec <container> python -c <code>   (via dockerode exec API)
  -> stream stdout/stderr into two RingBuffer(50KB) instances
  -> race(execPromise, timeout(45s))
       on timeout: docker kill + remove container, warmContainers.delete(runId), throw SandboxTimeoutError
       on success: release permit, return ExecutionResult
```
- One warm container per `run_id` (`Map<string, ContainerHandle>`), created with a long-running idle process (`tail -f /dev/null`) as CMD so `exec` has a live target between iterations.
- Semaphore permit is held **only for the duration of the exec call**, not the container's lifetime — many warm containers can sit idle simultaneously; the cap limits concurrent *executions*, not concurrent *containers*, matching ADR-021's daemon-contention rationale.
- **Per-run_id serialization:** `SandboxManager` holds a `Map<string, Mutex>` (one `async-mutex` `Mutex` per active `run_id`) so a second `runExplore()` call for the same `run_id` queues behind the first instead of `exec`-ing concurrently into the shared warm container. This is separate from the global Semaphore(2) — the mutex prevents state corruption within one run's container; the semaphore caps total daemon load across all runs. A call acquires its per-run mutex first, then the global semaphore, then execs.
- Network: default bridge (PyPI reachable). `ExecutionRequest` for explore takes a caller-supplied `workspacePath` (host directory), bind-mounted read-write at `/workspace` inside the container. `SandboxManager` only provides the mount point — it does not implement ADR-021's `workspace/skills/`, `workspace/models/` (persist) vs `workspace/scratch/` (wipe) policy; that split remains the caller's (M7's) responsibility, same as before, but the mount now exists so that policy isn't blocked on reopening this issue later.
- Caller (M7, not yet built) is responsible for calling `disposeRun(runId)` when a debate round ends; `SandboxManager` also runs an idle reaper (configurable, default 10 min) that kills+removes warm containers with no exec activity, so a crashed caller can't leak containers forever.

### Validate (cold, clean)
```
runValidate({ runId, modelScriptPath })
  -> acquire Semaphore(2) permit
  -> container = docker run --rm --network none --memory=512m --cpus=1
       -v <modelScriptPath>:/workspace/model.py:ro
       -v <repoRoot>/src/forecasting_agent/evaluation:/workspace/m8/evaluation:ro
       forecasting-sandbox:latest
       python /entrypoints/validate.py
  -> stream stdout/stderr into RingBuffer(50KB) x2
  -> race(execPromise, timeout(45s)); on timeout: kill + remove, throw SandboxTimeoutError
  -> release permit, extract EvalResult from the __EVAL_RESULT__-delimited stdout line, return ExecutionResult
```
- Always a **fresh cold-start container**, `--network none`, clean `forecasting-sandbox:latest` image (same image explore uses — no separate "validate image"; cleanliness comes from `--rm` + fresh container, not a different image).
- No output bind mount exists — the container is `--rm` and disappears the instant it exits, so nothing written to a mounted host path would be retrievable anyway. All result data crosses the container boundary via **stdout only**, already captured by the 50KB ring buffer.
- `validate.py` is the **only** thing ever exec'd in this tier — never arbitrary agent code. It:
  1. Executes `/workspace/model.py` (the agent's submitted script, mounted read-only) in a subprocess, which must write an `EvalRequest`-shaped JSON document to `/tmp/eval_request.json` — purely internal to the container, never mounted, never needs to survive past this process.
  2. Loads that JSON, constructs `EvalRequest` (Pydantic), calls `forecasting_agent.evaluation.evaluate()`.
  3. Prints `EvalResult` (Pydantic `.model_dump_json()`) to stdout on a single delimited final line (e.g. prefixed `__EVAL_RESULT__`), so `SandboxManager` can extract it from the captured stdout buffer without ambiguity against any prior print output from the model script.
  4. Any exception (model script crash, malformed JSON, Pydantic validation error, unapproved import) is caught, written as a structured error JSON to stdout behind the same delimiter, and the process exits non-zero — `SandboxManager` surfaces this as a typed `ValidationFailedError`, distinct from `SandboxTimeoutError`, so the caller can tell "your model is broken" from "infra timed out."
- This is intentionally the full scope of the M8 integration contract for this issue — M7 (orchestrator) does not exist yet, so the entrypoint contract (`eval_request.json` in, `eval_result.json` out) is the seam M7 will write against later, not something this issue builds a caller for.

## 4. Types (`harness/src/sandbox/types.ts`)

```ts
type SandboxTier = "explore" | "validate";

interface ExecutionRequest {
  runId: string;
  tier: SandboxTier;
  code?: string;              // explore only
  workspacePath?: string;     // explore only; host dir bind-mounted rw at /workspace
  modelScriptPath?: string;   // validate only
}

interface ExecutionResult {
  stdout: string;             // truncated to 50KB, flag if truncated
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number;
  durationMs: number;
  evalResult?: unknown;       // validate only, extracted from the __EVAL_RESULT__-delimited stdout line
}

interface SandboxConfig {
  concurrency?: number;         // default 2
  timeoutMs?: number;           // default 45_000
  stdioBufferBytes?: number;    // default 50 * 1024
  idleReaperMs?: number;        // default 10 * 60_000; warm containers idle longer than this are killed+removed
  memoryLimitBytes?: number;    // default 512 * 1024 * 1024
  cpuLimit?: number;            // default 1.0
}

class SandboxTimeoutError extends Error {}
class ValidationFailedError extends Error {}   // validate tier: model/M8 failure, not infra failure
class SandboxError extends Error {}            // generic docker/infra failure
```

Zod schemas mirror these for runtime validation at the `SandboxManager` public boundary (matches existing `harness/src` convention of `zod` for external-input validation).

## 5. Concurrency, timeout, buffer — enforcement points

- **Semaphore(2):** `async-mutex`'s `Semaphore`, one instance shared across `runExplore`/`runValidate` — acquired immediately before the docker exec/run call (in explore, after the per-`run_id` `Mutex` from §3 is already held), released in a `finally` right after that call settles (success, timeout, or error).
- **45s hard timeout:** `Promise.race([execPromise, delay(45_000).then(() => { throw new SandboxTimeoutError() })])`; the timeout branch also triggers `container.kill()` + `container.remove({ force: true })` for explore (removes the warm container so the next iteration starts clean) and relies on `--rm` for validate.
- **50KB ring buffer:** `RingBuffer` wraps a `Buffer` of fixed capacity; each stdout/stderr chunk from the dockerode stream is appended, oldest bytes dropped on overflow, `stdoutTruncated`/`stderrTruncated` flags set once any drop occurs. Applied per-tier identically.
- **Cgroups:** `--memory=512m --cpus=1` passed as `HostConfig.Memory` / `HostConfig.NanoCpus` in the dockerode create call for both tiers.

## 6. Docker image

- Base: `python:3.12-slim`.
- ~40 pinned packages from ADR-021 §network (pandas, numpy, scipy, statsmodels, scikit-learn, prophet, xgboost, lightgbm, pmdarima, arch, ta, …) plus `pydantic>=2.13` and `numpy>=2.5.2` (pinned to match `pyproject.toml` so M8's `EvalRequest`/`evaluate()` behave identically inside the container as outside).
- Non-root user `agent`, uid 1000, owns `/workspace`.
- `sandbox/entrypoints/validate.py` copied into the image at a fixed path (`/entrypoints/validate.py`), not mounted — it ships with the image so validate's behavior is pinned to the image version, not the host checkout.
- Tag: `forecasting-sandbox:latest`, built via `docker build -f sandbox/Dockerfile -t forecasting-sandbox:latest sandbox/`.

## 7. Error handling

| Failure | Detection | Result |
|---|---|---|
| 3rd concurrent request | Semaphore blocks (queues), does not error | Caller awaits; no error unless combined with timeout |
| Explore exec exceeds 45s | `Promise.race` timeout branch | `SandboxTimeoutError`, warm container killed+removed |
| Validate exec exceeds 45s | same | `SandboxTimeoutError`, container already `--rm` |
| stdout/stderr > 50KB | `RingBuffer` overflow | Result returned with `*Truncated: true`, not an error |
| Model script crashes in validate | `validate.py` catches, writes error JSON, exits non-zero | `ValidationFailedError` with captured detail |
| Model imports unapproved package in validate | `--network none` blocks pip install; ImportError inside `validate.py` | Same `ValidationFailedError` path — "obvious cause" per ADR-021 |
| Docker daemon unreachable / OOM kill (137) | dockerode throws / exit code 137 | `SandboxError`, distinguishable exit code surfaced in `ExecutionResult.exitCode` |

## 8. Testing

- **Unit (no Docker required, dockerode mocked):**
  - Semaphore blocks a 3rd concurrent `runExplore`/`runValidate` call until one of the first two releases.
  - Timeout branch fires at 45s and calls `kill`+`remove` on the mocked container.
  - `RingBuffer` truncates correctly at exactly 50KB and sets the truncated flag; verify oldest-bytes-dropped semantics.
- **Integration (requires Docker — now available via the Windows Docker Desktop / WSL2 bridge set up this session):**
  - Explore tier executes a real pandas script against the built image and returns stdout.
  - Validate tier: a script importing an unapproved package fails with `ValidationFailedError` inside `--network none`.
  - Validate tier: a real `eval_request.json` round-trips through M8's `evaluate()` and returns a matching `EvalResult`.
  - Cgroup limits: a script that allocates >512MB is OOM-killed (exit 137), surfaced as `SandboxError`.
- Integration tests are tagged so they can be skipped in environments without Docker (mirrors the existing `storage-integration.test.ts` pattern already in `harness/tests/`).

## 9. Open items explicitly deferred (not this issue)

- Wiping `workspace/scratch/` between runs — ADR-021 assigns this to the caller (M7), not the sandbox layer.
- PyPI package approval queue — logged as a follow-up idea in ADR-021, no queue infra exists yet; explore tier simply allows PyPI today.
- Multi-tenant isolation hardening — ADR-021 explicitly flags this as acceptable-for-single-user-only; out of scope here.
- **Swarm-scale sub-agent concurrency (MVP2 revisit)** — this design is sufficient for MVP1: `Semaphore(2)` + one warm container per `run_id` serializes M6's 4 sub-agents behind a shared container within a run, which is correct but not parallel. If a future swarm of sub-agents needs true within-run parallelism, two decisions from this spec need reopening together, not independently: (1) raise `concurrency` past the host-resource ceiling observed this session (~4GB/12 CPU Docker Desktop allocation caps concurrent 512MB/1CPU containers around 7-8 regardless of config), and (2) move from one warm container per `run_id` to one per `(run_id, agent)`, which was explicitly declined for MVP1 in favor of simplicity. Tracked here so MVP2 planning starts from this note instead of rediscovering the constraint.
