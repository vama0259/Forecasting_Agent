---
type: adr
date: 2026-08-21
status: decided
parent: "[[Forecasting Agent]]"
---

# General Local Docker Sandbox Foundation

**Companion ADR:** [`2026-08-21-general-evidence-storage-design.md`](./2026-08-21-general-evidence-storage-design.md)

## 1. Decision

Build a local, domain-neutral execution sandbox using one disposable Docker container per execution attempt. A trusted host broker stages immutable inputs, starts the container with a fixed policy, collects declared outputs, persists lifecycle evidence, and destroys the container.

This is greenfield. Existing TCS, finance, M8, debate, agent, prompt, model, and harness behavior does not define the runtime. Existing code may be consulted only for named failure lessons such as timeout cancellation, output bounding, stream demultiplexing, and orphan cleanup.

## 2. Startup scope

Build now:

- one local Docker host;
- at most two concurrent executions;
- one neutral untrusted-execution profile;
- no container networking or GPU;
- immutable read-only inputs;
- bounded tmpfs work, output, home, and temporary directories;
- trusted external output collection;
- lifecycle, cancellation, timeout, cleanup, and reconciliation tests against real Docker.

Defer:

- container networking, secret injection, persistent memory, GPUs, package installation, distributed scheduling, Kubernetes, microVMs, reproducibility workers, and trusted validator profiles.

## 3. Boundaries

```text
Application
  -> ExecutionBroker use case
       -> AuthorizationVerifier port
       -> ArtifactStager port
       -> SandboxRuntime port -> LocalDockerRuntime
       -> OutputCollector port
       -> ExecutionRepository port
       -> AuditSink port
```

Docker is an infrastructure adapter. Core execution policy and lifecycle types cannot import Docker or storage implementations. The sandbox never imports forecasting or industry rules.

## 4. Execution authorization

For the single-host startup, do not claim distributed cryptographic ticket signing. The trusted host creates a short-lived, one-time authorization record inside the same process and transaction boundary that owns provisioning.

The frozen authorization binds:

- authorization ID, creation time, expiry, and random 256-bit nonce hash;
- organization, project, run, attempt, and execution IDs;
- plan hash and execution-contract hash;
- approved image/platform digest;
- exact input artifact grants and normalized mount destinations;
- required output declarations;
- CPU, memory, PID, wall-time, tmpfs, file-count, and output-byte limits;
- network and GPU policy, both `NONE` initially.

The broker atomically verifies expiry/hash/state, marks the authorization redeemed, appends an audit event, and moves the execution from `AUTHORIZED` to `PROVISIONING` before creating Docker resources. Duplicate, expired, unknown, or unsupported controls fail closed. Retries use a new authorization and execution attempt.

If provisioning moves to a separate trust domain later, replace the local record with a versioned Ed25519 signed envelope containing a key ID and rotation policy. That is a scaling gate, not startup work.

## 5. Image policy

Use a version-controlled local allowlist of immutable image and platform digests. Startup admission checks the digest, configured non-root user contract, entrypoint contract, dependency lock, and runtime-conformance result.

Do not claim image signature verification in the initial local design. Registry or multi-host deployment requires Sigstore/Cosign verification, trusted identity policy, revocation, and an auditable verification record before image pull/admission.

No `latest` tags or tag fallback are permitted. The initial image is a neutral execution image; Python, scientific, finance, or model-specific images belong to later workload profiles.

## 6. Filesystem and quotas

```text
/inputs       read-only bind mounts of staged immutable files
/workspace    writable tmpfs with explicit size
/outputs      writable tmpfs with explicit size
/tmp          writable tmpfs with explicit size
/home/runtime writable tmpfs with explicit size
```

The trusted stager owns mount sources. Authorization supplies only normalized relative destination names. Reject absolute paths, traversal, control characters, ambiguous separators, collisions, links, devices, and unapproved mount destinations.

Use Docker tmpfs `size` limits for every writable directory in the initial profile. This is the chosen enforceable disk-bound mechanism; named-volume and host-filesystem quota claims are out of scope. Container memory, CPU, PID, and wall-time limits are separate controls.

The image runs as a fixed non-root UID/GID declared by the image contract. Random UID is deferred until an image and writable-mount ownership conformance strategy is implemented.

## 7. OCI hardening

- non-root user;
- no privileged mode or host devices;
- drop all Linux capabilities;
- `no-new-privileges`;
- read-only root filesystem;
- default Docker seccomp plus a reviewed tighter profile when evidence justifies it;
- private PID, IPC, mount, and network namespaces;
- PID, CPU, memory, wall-time, and tmpfs limits;
- no Docker socket, database, artifact-root, provider, or connector credentials;
- kill and await removal of the entire container on timeout or cancellation.

Unsupported mandatory controls reject provisioning. The adapter never silently weakens policy.

## 8. Network, tools, secrets, and memory

Containers have no network. Host connectors and tools run before provisioning and store their results as ordinary immutable input artifacts. Mid-execution input mutation is forbidden.

Containers receive no secrets. Persistent governed memory is deferred; any startup memory is an ordinary pre-staged artifact. Future capabilities require a separately reviewed broker contract rather than widening Docker access.

## 9. Command execution

Commands for one execution are serialized. Different executions may run concurrently within the two-slot scheduler. The broker fixes the user, working directory, environment allowlist, mounts, resource limits, and network policy.

Docker stdout/stderr streams are demultiplexed and consumed incrementally. Store bounded head-and-tail representations plus total byte and truncation counts. Never buffer unlimited output in memory.

Timeout and cancellation call Docker stop/kill, wait for terminal state, revoke temporary grants, and continue idempotent cleanup. Rejecting a JavaScript promise alone is not cancellation.

Typed failures include `COMMAND_FAILED`, `TIMED_OUT`, `OOM_KILLED`, `PID_LIMIT`, `STORAGE_LIMIT`, `CANCELLED`, `COLLECTION_FAILED`, `CLEANUP_FAILED`, and `RUNTIME_FAILED`.

## 10. Output collection

The frozen execution contract declares relative paths, required/optional status, media type/schema, per-file size, total size, and file-count limits.

Collection order:

1. stop or freeze execution and enter `COLLECTING`;
2. enumerate declared outputs without following links;
3. reject traversal, absolute paths, links, devices, undeclared files, invalid schemas, or exceeded limits;
4. stream accepted bytes through the host ArtifactStore;
5. verify hashes and required output availability;
6. atomically insert versions/lineage and transition to `COMPLETED`;
7. clean resources and record cleanup independently.

Optional evidence is determined by the execution contract. Prompts, code, models, tools, approvals, or skills are never universally mandatory.

## 11. Lifecycle

```text
AUTHORIZED -> PROVISIONING -> READY -> RUNNING -> COLLECTING -> COMPLETED

terminal failures:
REJECTED | FAILED | CANCELLED | TIMED_OUT | COLLECTION_FAILED | QUARANTINED

cleanup:
PENDING | RUNNING | COMPLETE | FAILED
```

Cleanup state is separate from execution state. Cleanup failure does not erase valid collected evidence. Startup reconciliation finds broker-owned containers by immutable labels, compares them with persisted state, and resumes cleanup or records a typed failure.

## 12. Scheduling and local profile

Implement a new in-process two-slot semaphore; do not inherit a legacy concurrency guard. Queueing is bounded and cancellable. Backpressure rejects excess work rather than overcommitting the host.

Initial limits are configuration, not performance claims. Neutral stress fixtures measure CPU, memory, PID, tmpfs, output, timeout, cancellation, and concurrent-execution behavior on the actual 16 GB machine. No analytics or scientific workload is assumed.

GPU is unavailable to containers. Any future GPU profile requires a dedicated image, device policy, resource tests, and conformance suite.

## 13. Audit and runtime port

Security-relevant events are append-only and mandatory before provisioning. Non-security telemetry may degrade without blocking execution.

```ts
interface SandboxRuntime {
  provision(request: ProvisionRequest): Promise<RuntimeHandle>;
  execute(handle: RuntimeHandle, command: CommandRequest): Promise<CommandResult>;
  freeze(handle: RuntimeHandle): Promise<void>;
  terminate(handle: RuntimeHandle, reason: TerminationReason): Promise<void>;
  destroy(handle: RuntimeHandle): Promise<CleanupResult>;
  inspect(handle: RuntimeHandle): Promise<RuntimeState>;
}
```

Each adapter declares supported controls. Provisioning rejects any mandatory control the adapter cannot enforce.

## 14. Real-Docker conformance

Tests against the pinned local Docker runtime prove:

- no network, GPU, Docker socket, credentials, or arbitrary host mounts;
- root filesystem is read-only and the process is non-root;
- inputs are read-only and exact-hash verified;
- writable tmpfs mounts enforce configured byte limits;
- memory, PID, CPU, wall-time, cancellation, and whole-container termination work;
- stdout/stderr remain bounded under hostile output;
- traversal, links, devices, undeclared paths, count/size excess, and schema failures are rejected;
- duplicate or expired authorization cannot provision;
- collection ordering and lifecycle persistence are consistent;
- broker crash/orphan reconciliation is idempotent;
- two-slot admission never runs a third container.

Use only neutral fixtures and pinned image digests.

## 15. Scaling gates

Before container networking: add a trusted egress gateway with destination, protocol, byte, expiry, DNS, redirect, and private-address controls.

Before multiple hosts: cryptographically signed authorization envelopes, shared scheduling, leases, image signature verification, and shared artifact storage are mandatory.

Before hostile native-code or regulated workloads: evaluate microVMs or dedicated workers; hardened containers do not claim kernel isolation.

## 16. Acceptance criteria

- A domain-neutral execution completes without agent, prompt, model, skill, approval, or finance concepts.
- Every mandatory authorization control is enforced or provisioning fails closed.
- Writable disk bounds use verified tmpfs limits rather than unsupported named-volume quotas.
- Timeout and cancellation terminate the actual container, not only the caller promise.
- Required outputs become available before completion; collection failure never completes.
- Cleanup and crash reconciliation are repeatable and visible.
- At most two containers run concurrently on the local host.
- No fixture, image profile, mount, or runtime type encodes an industry or forecasting protocol.

## 17. Decision summary

Use a trusted local broker and one hardened, networkless, disposable Docker container per generic execution. Enforce immutable inputs, bounded tmpfs writes, resource limits, external collection, durable lifecycle evidence, and cleanup. Defer distributed security and every domain-specific workload until real use cases require them.

## Review log

- 2026-08-21: Initial adversarial review rejected legacy agent/LLM fields, universally mandatory prompt/tool evidence, undefined signing claims, inconsistent backup, and unsupported disk quotas.
- 2026-08-21: Greenfield rewrite removed those assumptions; cross-spec review then found and resolved missing execution-contract and authorization records.
