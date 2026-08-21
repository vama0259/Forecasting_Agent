---
type: plan
date: 2026-08-21
status: proposed
parent: "[[Forecasting Agent]]"
specs:
  - "[[2026-08-21-general-evidence-storage-design.md]]"
  - "[[2026-08-21-general-oci-sandbox-design.md]]"
---

# Generic Forecasting Foundation: Exhaustive Implementation & Verification Plan

**Companion ADRs:**
- [`docs/superpowers/specs/2026-08-21-general-evidence-storage-design.md`](../specs/2026-08-21-general-evidence-storage-design.md)
- [`docs/superpowers/specs/2026-08-21-general-oci-sandbox-design.md`](../specs/2026-08-21-general-oci-sandbox-design.md)
- [`docs/engineering-standards.md`](../../engineering-standards.md)

---

## 1. System Architecture & Boundaries

```text
Vercel / Next.js UI (Future Client)
        │
        ▼ (HTTP / SSE / WebSocket)
Node.js 24.19.0 LTS + TypeScript 7.0.2 Control Plane (pnpm 11.22.0)
┌─────────────────────────────────────────────────────────────────────────────┐
│ src/core/ (Zero external I/O or adapter imports)                             │
│ ├── Identifiers, Branded Types, Discriminated Unions                        │
│ ├── Pure Policies: CutoffPolicy, AuthorizationPolicy                        │
│ ├── Pure Utils: RFC 8785 Canonical JSON, Streaming SHA-256 Digest         │
│ └── Consumer-Owned Ports: ArtifactStore, StorageRepository, ExecutionRepo,  │
│     AuditSink, SandboxRuntime, WriteBarrier                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ src/storage/ (Persistence & Reconstruction Use Cases)                       │
│ ├── PublicationUseCase, OutcomeResolutionUseCase, EvaluationUseCase        │
│ ├── ReconstructionService (Offline Byte & Hash Verifier)                    │
│ └── BackupRestoreService (Advisory Lock + Atomic Snapshot Coordinator)       │
├─────────────────────────────────────────────────────────────────────────────┤
│ src/execution/ (Container Broker & Scheduler Use Cases)                     │
│ ├── ExecutionBroker, ArtifactStager, OutputCollector                        │
│ ├── TwoSlotSemaphore (Bounded In-Process Concurrency Gate)                  │
│ └── StartupReconciler (Bidirectional Container <-> DB Reconciler)          │
├─────────────────────────────────────────────────────────────────────────────┤
│ src/adapters/ (Infrastructure Implementations)                              │
│ ├── storage/       LocalArtifactStore (Atomic fsync-rename, verified reads) │
│ ├── postgres/      PostgreSQL 18 Adapter, Migration Runner, Advisory Locks  │
│ └── podman/        RootlessPodmanRuntime (Libpod API over Unix socket)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ src/app/ (Composition Root)                                                 │
│ └── bootstrap.ts, config.ts, shutdown.ts                                    │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼ (Libpod Unix Socket: %t/podman/podman.sock)
Rootless Podman 5.8.4 Engine (cgroup v2, Fedora SELinux)
└── Disposable OCI Containers (Max 2 slots, networkless, read-only rootfs)
```

---

## 2. Complete File Tree & Responsibility Inventory

All handwritten TypeScript files strictly satisfy:
- Max 300 physical lines.
- Max 88 characters per line.
- 4-line module TSDoc header (`Purpose`, `Responsibility`, `Inputs/outputs`, `Excludes`).
- 2-line exported function/method TSDoc (`Behavior/preconditions`, `Result/failure/side-effects`).

```text
.
├── .eslintrc.cjs
├── .prettierrc
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── migrations/
│   └── 001_initial_schema.sql
├── scripts/
│   ├── check-tsdoc.ts
│   └── check-architecture.ts
├── src/
│   ├── core/
│   │   ├── types/
│   │   │   ├── identifiers.ts
│   │   │   ├── lifecycle.ts
│   │   │   ├── contracts.ts
│   │   │   ├── artifacts.ts
│   │   │   └── execution.ts
│   │   ├── errors/
│   │   │   ├── domain-error.ts
│   │   │   ├── point-in-time.error.ts
│   │   │   ├── artifact-corrupted.error.ts
│   │   │   ├── authorization.error.ts
│   │   │   ├── resource-limit.error.ts
│   │   │   └── execution-timeout.error.ts
│   │   ├── utils/
│   │   │   ├── canonical-json.ts
│   │   │   └── crypto-hash.ts
│   │   ├── policies/
│   │   │   ├── cutoff-policy.ts
│   │   │   └── authorization-policy.ts
│   │   └── ports/
│   │       ├── artifact-store.port.ts
│   │       ├── storage-repository.port.ts
│   │       ├── execution-repository.port.ts
│   │       ├── audit-sink.port.ts
│   │       ├── outcome-repository.port.ts
│   │       ├── evaluation-repository.port.ts
│   │       ├── write-barrier.port.ts
│   │       └── sandbox-runtime.port.ts
│   ├── storage/
│   │   ├── use-cases/
│   │   │   ├── stage-artifact.use-case.ts
│   │   │   ├── commit-artifact.use-case.ts
│   │   │   ├── create-publication.use-case.ts
│   │   │   ├── resolve-outcome.use-case.ts
│   │   │   └── evaluate-publication.use-case.ts
│   │   ├── reconstruction/
│   │   │   ├── manifest-builder.ts
│   │   │   └── reconstruction-service.ts
│   │   └── backup/
│   │       ├── backup-service.ts
│   │       └── restore-service.ts
│   ├── execution/
│   │   ├── scheduler/
│   │   │   └── two-slot-semaphore.ts
│   │   ├── broker/
│   │   │   ├── artifact-stager.ts
│   │   │   ├── output-collector.ts
│   │   │   └── execution-broker.ts
│   │   └── reconciliation/
│   │       └── startup-reconciler.ts
│   ├── adapters/
│   │   ├── storage/
│   │   │   └── local-artifact-store.ts
│   │   ├── postgres/
│   │   │   ├── postgres-pool.ts
│   │   │   ├── postgres-migrator.ts
│   │   │   ├── postgres-write-barrier.ts
│   │   │   ├── postgres-storage-repo.ts
│   │   │   ├── postgres-execution-repo.ts
│   │   │   ├── postgres-audit-sink.ts
│   │   │   ├── postgres-outcome-repo.ts
│   │   │   └── postgres-evaluation-repo.ts
│   │   └── podman/
│   │       ├── libpod-client.ts
│   │       ├── stream-demuxer.ts
│   │       └── rootless-podman-runtime.ts
│   └── app/
│       ├── config.ts
│       ├── composition-root.ts
│       └── main.ts
└── tests/
    ├── unit/
    │   ├── scaffolding-linter.test.ts
    │   ├── canonical-json.test.ts
    │   ├── crypto-hash.test.ts
    │   ├── cutoff-policy.test.ts
    │   ├── authorization-policy.test.ts
    │   ├── two-slot-semaphore.test.ts
    │   └── stream-demuxer.test.ts
    ├── integration/
    │   ├── local-artifact-store.test.ts
    │   ├── postgres-migrations.test.ts
    │   ├── postgres-storage-repo.test.ts
    │   ├── postgres-execution-repo.test.ts
    │   ├── postgres-publication-lock.test.ts
    │   ├── postgres-outcome-settlement.test.ts
    │   ├── postgres-write-barrier.test.ts
    │   ├── postgres-audit-sequence.test.ts
    │   └── backup-restore.test.ts
    ├── conformance/
    │   ├── podman-security-hardening.test.ts
    │   ├── podman-entrypoint-contract.test.ts
    │   ├── podman-tmpfs-quota.test.ts
    │   ├── podman-signals-cancellation.test.ts
    │   ├── podman-stream-bounding.test.ts
    │   ├── podman-output-collection.test.ts
    │   ├── podman-concurrency-gate.test.ts
    │   └── podman-crash-reconciliation.test.ts
    └── e2e/
        ├── non-llm-statistical-forecast.test.ts
        ├── offline-reconstruction.test.ts
        └── disaster-recovery.test.ts
```

---

## 3. Database Schema & Migration Specification

### File: `migrations/001_initial_schema.sql`

```sql
-- PostgreSQL 18.4 Initial Schema for Generic Forecasting Foundation

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organizations & Principals
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE principals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Projects & Contracts
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    slug VARCHAR(64) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);

CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    input_schema JSONB NOT NULL,
    output_schema JSONB NOT NULL,
    cutoff_policy JSONB NOT NULL,
    resolution_policy JSONB NOT NULL,
    evaluation_policy JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    contract_hash CHAR(64) NOT NULL,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version)
);

CREATE TABLE execution_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    input_declarations JSONB NOT NULL,
    output_declarations JSONB NOT NULL,
    resource_policy JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    contract_hash CHAR(64) NOT NULL,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version)
);

-- 3. Runs & Attempts
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    cutoff_at TIMESTAMPTZ NOT NULL,
    resolve_after TIMESTAMPTZ NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE run_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL,
    plan JSONB NOT NULL,
    plan_hash CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    failure_code VARCHAR(64),
    failure_detail TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, attempt_number)
);

-- 4. Executions, Authorizations, Commands & Events
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_attempt_id UUID NOT NULL REFERENCES run_attempts(id) ON DELETE RESTRICT,
    execution_kind VARCHAR(64) NOT NULL,
    execution_contract_id UUID NOT NULL REFERENCES execution_contracts(id) ON DELETE RESTRICT,
    authorization_hash CHAR(64) NOT NULL,
    runtime_digest VARCHAR(255) NOT NULL,
    platform_digest VARCHAR(255) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'AUTHORIZED',
    cleanup_state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    failure_stage VARCHAR(64),
    failure_code VARCHAR(64),
    failure_detail TEXT,
    exit_code INTEGER,
    cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    provisioning_deadline TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID UNIQUE NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    authorization_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    redeemed_at TIMESTAMPTZ,
    authorization_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    command_sequence INTEGER NOT NULL,
    argv JSONB NOT NULL,
    working_directory VARCHAR(255) NOT NULL,
    environment JSONB NOT NULL,
    stdin_artifact_version_id UUID,
    timeout_ms INTEGER NOT NULL,
    command_hash CHAR(64) NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    exit_code INTEGER,
    failure_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (execution_id, command_sequence)
);

CREATE TABLE execution_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID REFERENCES runs(id) ON DELETE RESTRICT,
    execution_id UUID REFERENCES executions(id) ON DELETE RESTRICT,
    principal_id UUID REFERENCES principals(id) ON DELETE RESTRICT,
    event_type VARCHAR(64) NOT NULL,
    details JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Artifacts, Lineage, Inputs & Outputs
CREATE TABLE artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    kind VARCHAR(64) NOT NULL,
    logical_name VARCHAR(255) NOT NULL,
    sensitivity VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE artifact_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'STAGED',
    content_sha256 CHAR(64) NOT NULL,
    content_bytes BIGINT NOT NULL,
    media_type VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL,
    available_from TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ,
    source_published_at TIMESTAMPTZ,
    retrieved_at TIMESTAMPTZ NOT NULL,
    produced_by_execution_id UUID REFERENCES executions(id) ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (artifact_id, version)
);

CREATE TABLE artifact_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    parent_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    child_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    relation VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    purpose VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (execution_id, artifact_version_id, purpose)
);

CREATE TABLE execution_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    disposition VARCHAR(32) NOT NULL DEFAULT 'DECLARED',
    declaration_name VARCHAR(64),
    publishable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial Unique Index on declared outputs
CREATE UNIQUE INDEX uq_execution_declared_output
ON execution_outputs(execution_id, declaration_name)
WHERE disposition = 'DECLARED';

-- 6. Publications, Outcomes & Evaluations
CREATE TABLE publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID UNIQUE NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    run_attempt_id UUID NOT NULL REFERENCES run_attempts(id) ON DELETE RESTRICT,
    contract_hash CHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    reconstruction_manifest_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outcome_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'PROVISIONAL',
    payload JSONB NOT NULL,
    source_artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    resolver_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publication_id, version)
);

CREATE TABLE evaluation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
    outcome_version_id UUID NOT NULL REFERENCES outcome_versions(id) ON DELETE RESTRICT,
    definition_hash CHAR(64) NOT NULL,
    implementation_versions JSONB NOT NULL,
    metrics JSONB NOT NULL,
    baseline_metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Phase-by-Phase Implementation & Detailed Test Specifications

---

### Phase 1: Toolchain Scaffolding & Enforcement Tooling

#### Step 1.1: Project Configuration & Scripts
* **Files:**
  * `package.json`: Target Node.js `24.19.0`, TypeScript `7.0.2`, pnpm `11.22.0`, Vitest `3.0.0`, pg `8.13.0`.
  * `tsconfig.json`: `target: "ES2024"`, `module: "NodeNext"`, `strict: true`, `noUncheckedIndexedAccess: true`.
  * `.eslintrc.cjs`: `max-lines: ["error", 300]`, `max-len: ["error", { "code": 88 }]`.
  * `.prettierrc`: `printWidth: 88`, `singleQuote: true`.
  * `scripts/check-tsdoc.ts`: AST visitor asserting:
    1. Every file starts with 4-line module TSDoc (`Purpose:`, `Responsibility:`, `Inputs/outputs:`, `Excludes:`).
    2. Every exported function has $\ge 2$ content lines.
  * `scripts/check-architecture.ts`: Dependency analyzer verifying `src/core/` does not import `src/adapters/`, `src/storage/`, or external I/O.

#### Step 1.2: Tests for Scaffolding Tools
* **Test File:** `tests/unit/scaffolding-linter.test.ts`
  * **Test 1:** Validates compliant file passes AST TSDoc check.
  * **Test 2:** Validates missing `Excludes:` line in header triggers exit code 1.
  * **Test 3:** Validates file exceeding 300 physical lines or 88 characters triggers linter failure.
  * **Test 4:** Validates forbidden import in `src/core/` (e.g. `import pg from 'pg'`) triggers architecture violation.

---

### Phase 2: Core Domain, Branded Types, Policies & Pure Utilities

#### Step 2.1: Types & Value Objects
* **Files:**
  * `src/core/types/identifiers.ts`: Branded UUID types:
    ```ts
    export type OrganizationId = string & { readonly __brand: unique symbol };
    export type ProjectId = string & { readonly __brand: unique symbol };
    export type RunId = string & { readonly __brand: unique symbol };
    export type ExecutionId = string & { readonly __brand: unique symbol };
    export type ArtifactId = string & { readonly __brand: unique symbol };
    export type ArtifactVersionId = string & { readonly __brand: unique symbol };
    export type PublicationId = string & { readonly __brand: unique symbol };
    ```
  * `src/core/types/lifecycle.ts`:
    ```ts
    export type RunState = 'OPEN' | 'PUBLISHED' | 'ABANDONED';
    export type RunAttemptState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABANDONED';
    export type ExecutionState =
      | 'AUTHORIZED' | 'PROVISIONING' | 'READY' | 'RUNNING'
      | 'COLLECTING' | 'COMPLETED' | 'REJECTED' | 'FAILED'
      | 'CANCELLED' | 'TIMED_OUT' | 'COLLECTION_FAILED' | 'QUARANTINED';
    export type CleanupState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    export type OutcomeState = 'PROVISIONAL' | 'SETTLED' | 'DISPUTED' | 'VOID';
    ```

#### Step 2.2: Pure Utilities (Canonical JSON & Crypto)
* **Files:**
  * `src/core/utils/canonical-json.ts`: `canonicalize(value: unknown): string` (RFC 8785 strict key sorting, Unicode normalization, number formatting).
  * `src/core/utils/crypto-hash.ts`:
    * `sha256Hex(data: Uint8Array | string): string`
    * `createSha256Stream(): { write: (chunk: Uint8Array) => void; digestHex: () => string; byteCount: () => number }`

#### Step 2.3: Pure Policies
* **Files:**
  * `src/core/policies/cutoff-policy.ts`:
    ```ts
    export function isEvidenceEligible(
      artifactAvailableFrom: Date,
      runCutoffAt: Date,
      artifactState: ArtifactVersionState
    ): boolean {
      return artifactState === 'AVAILABLE' && artifactAvailableFrom.getTime() <= runCutoffAt.getTime();
    }
    ```
  * `src/core/policies/authorization-policy.ts`:
    * `computePlanHash(plan: CanonicalPlan): Sha256Hash`
    * `computeCommandSetHash(commands: readonly ExecutionCommandDeclaration[]): Sha256Hash`
    * `computeAuthorizationHash(payload: AuthorizationPayload): Sha256Hash`

#### Step 2.4: Unit Tests for Core
* **Test File:** `tests/unit/canonical-json.test.ts`
  * **Test 1:** Sorts deeply nested object keys alphabetically (`{"b":1,"a":{"d":2,"c":3}}` $\to$ `{"a":{"c":3,"d":2},"b":1}`).
  * **Test 2:** Rejects `NaN`, `Infinity`, and cyclic references with typed `SerializationError`.
* **Test File:** `tests/unit/cutoff-policy.test.ts`
  * **Test 1:** Approves evidence where `available_from === cutoff_at`.
  * **Test 2:** Rejects evidence where `available_from = cutoff_at + 1ms` with `PointInTimeViolationError`.
  * **Test 3:** Rejects evidence in `STAGED` or `REJECTED` state regardless of timestamp.
* **Test File:** `tests/unit/authorization-policy.test.ts`
  * **Test 1:** Computes exact RFC 8785 SHA-256 over authorization payload.
  * **Test 2:** Proves single-character modification in `argv` or environment changes `command_set_hash` and `authorization_hash`.

---

### Phase 3: Content-Addressed Local ArtifactStore & Verified Streaming

#### Step 3.1: ArtifactStore Implementation
* **Files:**
  * `src/core/ports/artifact-store.port.ts`: Port interface:
    ```ts
    export interface ArtifactStore {
      stage(input: ReadableStream<Uint8Array>, expected?: ExpectedContent): Promise<StagedObject>;
      commit(staged: StagedObject): Promise<CommittedObject>;
      materializeVerified(key: ArtifactKey, expected: ExpectedContent, destination: StagingPath): Promise<VerifiedFile>;
      exists(key: ArtifactKey): Promise<boolean>;
    }
    ```
  * `src/adapters/storage/local-artifact-store.ts`:
    * Writes incoming stream to `data/artifacts/.tmp/<uuid>.staging`.
    * Computes SHA-256 and byte length on the fly.
    * Calls `fsync` on file descriptor before closing.
    * Atomically renames to `data/artifacts/<org-id>/sha256/<first2>/<full-sha256>`.
    * `materializeVerified()` reads from storage key, streams through hash verifier into target destination, asserts hash matches `key.content_sha256`, throws `ArtifactCorruptedError` on discrepancy without leaving unverified files.

#### Step 3.2: Integration Tests for ArtifactStore
* **Test File:** `tests/integration/local-artifact-store.test.ts`
  * **Test 1 (Happy Path):** Streams 5 MB payload $\to$ stages $\to$ commits $\to$ verifies file exists at exact canonical hex path with correct SHA-256.
  * **Test 2 (Crash Simulation):** Simulates stream interruption mid-write $\to$ verifies staging temp file is unlinked and no corrupted artifact is committed.
  * **Test 3 (Tampering Detection):** Mutates 1 byte inside committed file on disk $\to$ calls `materializeVerified()` $\to$ asserts `ArtifactCorruptedError` is thrown and destination file is removed.
  * **Test 4 (Streaming Memory Limit):** Streams 100 MB payload with Node.js heap limited to 64 MB $\to$ verifies stream backpressure prevents heap exhaustion.

---

### Phase 4: PostgreSQL Repositories, Migrations & Advisory Write Barrier

#### Step 4.1: Database Adapters
* **Files:**
  * `src/adapters/postgres/postgres-pool.ts`: Connection pool with automatic connection release, transaction wrappers, and query logging.
  * `src/adapters/postgres/postgres-write-barrier.ts`:
    ```ts
    export class PostgresWriteBarrier implements WriteBarrier {
      async acquireShared(): Promise<BarrierRelease>; // SELECT pg_advisory_lock_shared(...)
      async acquireExclusive(): Promise<BarrierRelease>; // SELECT pg_advisory_lock(...)
    }
    ```
  * `src/adapters/postgres/postgres-storage-repo.ts`: Inserts and queries organizations, projects, contracts, runs, attempts, artifacts, and versions.
  * `src/adapters/postgres/postgres-execution-repo.ts`: Manages execution records, redeems authorization in atomic transaction, stores commands, and logs outputs.
  * `src/adapters/postgres/postgres-audit-sink.ts`: Appends to `execution_events` with auto-incrementing `event_sequence`.
  * `src/adapters/postgres/postgres-outcome-repo.ts`: Appends outcome versions with `SELECT ... FOR UPDATE` row lock on publication.
  * `src/adapters/postgres/postgres-evaluation-repo.ts`: Gated final evaluation insertion asserting `outcome_versions.state = 'SETTLED'`.

#### Step 4.2: Integration Tests for Database & Concurrency
* **Test File:** `tests/integration/postgres-publication-lock.test.ts`
  * **Test 1 (Concurrent Publication Race):** Spawns 2 concurrent workers attempting to insert publication for same `run_id` $\to$ asserts Worker 1 commits successfully, Worker 2 receives `PostgresUniqueViolationError (23505)`.
* **Test File:** `tests/integration/postgres-outcome-settlement.test.ts`
  * **Test 1 (Settled Gated Evaluation):** Attempts to insert `evaluation_runs` against outcome version with state `PROVISIONAL` $\to$ asserts transaction rejects with `OutcomeNotSettledError`.
  * **Test 2 (Concurrent Dispute Race):** Worker 1 calls `createFinalEvaluation` while Worker 2 calls `appendOutcomeVersion(state: DISPUTED)` on same publication $\to$ row-lock serializes transactions $\to$ stale evaluation fails.
* **Test File:** `tests/integration/postgres-write-barrier.test.ts`
  * **Test 1 (Exclusive Lock Blocks Writers):** Thread 1 acquires exclusive write barrier $\to$ Thread 2 attempts repository insert $\to$ asserts Thread 2 blocks until Thread 1 releases lock.
* **Test File:** `tests/integration/postgres-audit-sequence.test.ts`
  * **Test 1 (Deterministic Event Ordering):** Emits 50 concurrent events across 5 async tasks for same execution $\to$ queries `execution_events` ordered by `event_sequence` $\to$ verifies strictly increasing integer sequence without collisions.

---

### Phase 5: Rootless Podman Runtime Adapter & Scheduler

#### Step 5.1: Podman Adapter & Concurrency Gate
* **Files:**
  * `src/adapters/podman/libpod-client.ts`: HTTP client over Unix domain socket `%t/podman/podman.sock`.
  * `src/adapters/podman/stream-demuxer.ts`: Demultiplexes Libpod 8-byte multiplexed frames (`[stream_type:1, 0, 0, 0, size:4]`) into stdout/stderr streams, tracks byte counts, and maintains bounded 64 KB head and 64 KB tail buffers.
  * `src/adapters/podman/image-admission.ts`: Verifies the allowlisted image/platform digest, non-root user contract, and dependency lock. Also enforces the entrypoint contract: the image's PID 1 must remain running after the workload command completes, until the broker explicitly terminates it. Podman tears down a container's mount namespace — and every tmpfs-backed writable directory with it — the instant its process exits, is paused, or is stopped, so an image whose entrypoint exits immediately after the command is rejected at admission, before any execution is authorized.
  * `src/adapters/podman/rootless-podman-runtime.ts`:
    * Constructs container payload:
      ```json
      {
        "image": "<immutable_digest>",
        "user": "1000:1000",
        "read_only": true,
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges"],
        "net_mode": "none",
        "ipc_mode": "private",
        "pid_mode": "private",
        "resource_limits": {
          "memory": 3221225472,
          "pids_limit": 64,
          "cpu_quota": 100000
        },
        "mounts": [
          { "type": "bind", "source": "/staging/path", "destination": "/inputs", "options": ["ro", "Z"] },
          { "type": "tmpfs", "destination": "/workspace", "options": ["rw", "size=536870912"] },
          { "type": "tmpfs", "destination": "/outputs", "options": ["rw", "size=268435456"] },
          { "type": "tmpfs", "destination": "/tmp", "options": ["rw", "size=134217728"] },
          { "type": "tmpfs", "destination": "/home/runtime", "options": ["rw", "size=67108864"] }
        ],
        "labels": {
          "io.forecasting.foundation.managed-by": "broker",
          "io.forecasting.foundation.execution-id": "<id>",
          "io.forecasting.foundation.run-attempt-id": "<id>",
          "io.forecasting.foundation.created-at": "<iso>"
        }
      }
      ```
  * `src/execution/scheduler/two-slot-semaphore.ts`: In-memory async semaphore (`maxConcurrency: 2`, `queueCapacity: 10`, `timeoutMs: 30000`).

#### Step 5.2: Real Rootless Podman Conformance Tests
* **Test File:** `tests/conformance/podman-security-hardening.test.ts`
  * **Test 1 (Network Denial):** Container attempts `ping 1.1.1.1` or socket connect $\to$ asserts `EPERM` / `ENETUNREACH`.
  * **Test 2 (Read-Only Root):** Container attempts `touch /etc/hacked` $\to$ asserts `EROFS (Read-only file system)`.
  * **Test 3 (Non-Root User):** Container runs `id -u` $\to$ asserts `1000`.
  * **Test 4 (Capability Drop):** Container attempts `chown` or `setuid` $\to$ asserts `EPERM`.
* **Test File:** `tests/conformance/podman-entrypoint-contract.test.ts`
  * **Test 1 (Exit-Immediately Image Rejected):** Allowlists an image whose entrypoint exits as soon as the workload command returns $\to$ admission check inspects the image contract $\to$ asserts the image is rejected before any execution is authorized.
  * **Test 2 (Tmpfs Unreadable Once Exited):** Runs a compliant container that writes a file to `/outputs` then exits on its own $\to$ asserts `podman cp` and `podman exec` against the exited container both fail to read `/outputs`, proving why collection must always happen before termination.
* **Test File:** `tests/conformance/podman-tmpfs-quota.test.ts`
  * **Test 1 (Tmpfs Limit vs Memory):** Container writes 600 MB into `/workspace` (512 MB tmpfs limit) $\to$ asserts container process receives `ENOSPC`, exit code non-zero, and error mapped to `STORAGE_LIMIT` (not `OOM_KILLED`).
  * **Test 2 (Memory RSS Limit):** Container allocates 2.0 GB heap in memory $\to$ asserts cgroup OOM killer terminates process $\to$ maps to `OOM_KILLED`.
* **Test File:** `tests/conformance/podman-signals-cancellation.test.ts`
  * **Test 1 (Diagnostic Collection Before Termination):** Container writes a partial `/outputs/res.json` then enters an infinite loop $\to$ timeout expires $\to$ broker enters `COLLECTING` and reads the partial file and bounded logs from the still-`RUNNING` container, marking them `disposition: DIAGNOSTIC, publishable: false` $\to$ only then sends `SIGTERM`, waits 5s, sends `SIGKILL` $\to$ container terminates, slot released, state marked `TIMED_OUT`.
  * **Test 2 (Cancel Before Any Collectible Output):** Container is cancelled before writing anything to `/outputs` $\to$ diagnostic collection retains only bounded logs, records collection as partial, does not require missing outputs $\to$ execution reaches `CANCELLED`, never `COMPLETED`.
* **Test File:** `tests/conformance/podman-stream-bounding.test.ts`
  * **Test 1 (Hostile Flood):** Container outputs 50 MB of continuous stdout $\to$ stream demuxer consumes stream with backpressure $\to$ stores exact total byte count (52,428,800), truncation count, head 64 KB, tail 64 KB without exceeding Node.js memory ceiling.
* **Test File:** `tests/conformance/podman-concurrency-gate.test.ts`
  * **Test 1 (Two-Slot Gate):** Launches 3 concurrent executions $\to$ verifies Executions 1 & 2 run simultaneously in Podman $\to$ Execution 3 waits in queue until Execution 1 completes $\to$ asserts at no point are 3 containers running.

---

### Phase 6: Output Collector, Execution Broker & Crash Reconciler

#### Step 6.1: Broker Engine
* **Files:**
  * `src/execution/broker/artifact-stager.ts`: Creates private directory `/tmp/staging/<execution_id>`, copies verified input artifacts, applies the required Fedora SELinux **private** relabel (`chcon -Rt container_file_t` / mount option `:Z`, not shared `:z`) to that staging directory only, then mounts it read-only.
  * `src/execution/broker/output-collector.ts`:
    * Podman tears down every tmpfs-backed writable directory as soon as a container's process exits, is paused, or is stopped; there is no runtime path to read `/workspace`, `/outputs`, `/tmp`, or `/home/runtime` afterward, by `cp` or by `exec`. Collection therefore always runs against a container that is still `RUNNING` — the container is never frozen, stopped, or allowed to exit before its declared outputs are read.
    * Enters `COLLECTING` while the container is still `RUNNING`; enumerates declared outputs; rejects traversal, absolute paths, symlinks, hardlinks, character devices, undeclared files, or files exceeding declared per-file/total limits.
    * Stages and commits accepted output files into `ArtifactStore`; verifies hashes and required-output availability; only after collection completes or fails does it stop the container and await its exit.
    * If the container has already exited on its own before collection starts, transitions directly to `COLLECTION_FAILED`: required declared outputs cannot be read from a torn-down tmpfs, so collection cannot proceed regardless of exit code.
    * Diagnostic mode: on timeout/cancellation, collects bounded logs and any readable declared outputs from the still-`RUNNING` container first, marks them `disposition: DIAGNOSTIC, publishable: false`, and only then terminates the container.
  * `src/execution/broker/execution-broker.ts`: Coordinates authorization verification, slot acquisition, staging, execution, output collection, and database commit in one atomic metadata transaction.
  * `src/execution/reconciliation/startup-reconciler.ts`:
    * Sweep 1 (Runtime $\to$ DB): Inspects all containers labeled `managed-by=broker`. If DB state is terminal or execution unknown $\to$ calls `destroy()`.
    * Sweep 2 (DB $\to$ Runtime): Queries DB executions in `PROVISIONING`, `READY`, `RUNNING`, `COLLECTING`. If no matching container exists and `NOW() > provisioning_deadline` $\to$ marks execution as `FAILED` (`failure_code: 'BROKER_CRASHED'`).

#### Step 6.2: Integration & Reconciliation Tests
* **Test File:** `tests/conformance/podman-output-collection.test.ts`
  * **Test 1 (Running-Container Collection):** Container writes `/outputs/res.json` and then blocks on the entrypoint contract, still `RUNNING` $\to$ collector extracts `res.json` while the container is `RUNNING`, then stops it $\to$ records `execution_outputs` and transitions to `COMPLETED`.
  * **Test 2 (Symlink Attack Rejection):** Container creates symlink `/outputs/leak -> /etc/shadow` $\to$ collector detects link $\to$ rejects collection with `COLLECTION_FAILED` $\to$ marks execution `FAILED`.
  * **Test 3 (Unexpected Pre-Collection Exit):** Container exits on its own before the broker calls collection $\to$ asserts `podman cp`/`podman exec` cannot read `/outputs` from the exited container and the execution transitions directly to `COLLECTION_FAILED`, never `COMPLETED`.
* **Test File:** `tests/conformance/podman-crash-reconciliation.test.ts`
  * **Test 1 (Orphan Container Cleanup):** Creates container with broker labels, simulates broker crash, restarts broker $\to$ reconciler detects orphan $\to$ removes container from Podman.
  * **Test 2 (Dangling State Recovery):** Inserts execution in `PROVISIONING` with expired deadline, simulates broker crash before container creation $\to$ restarts broker $\to$ reconciler marks DB execution `FAILED` (`BROKER_CRASHED`).

---

### Phase 7: Reconstruction Engine, Backup/Restore & E2E Verification

#### Step 7.1: Reconstruction & Disaster Recovery
* **Files:**
  * `src/storage/reconstruction/manifest-builder.ts`:
    * Generates deterministic canonical JSON containing: `organization_id`, `project_id`, `run_id`, `run_attempt_id`, `contract_hash`, `plan_hash`, `execution_commands`, `runtime_digest`, `platform_digest`, `input_artifacts` (with hashes/sizes), `output_artifacts` (with hashes/sizes), `publication_id`, and `publication_payload_hash`.
  * `src/storage/reconstruction/reconstruction-service.ts`:
    * Offline verification: reads database metadata, reads filesystem bytes from `data/artifacts/`, verifies every artifact hash, recalculates canonical JSON hashes for contracts, plans, commands, and manifests $\to$ returns boolean verification report.
  * `src/storage/backup/backup-service.ts`:
    1. Acquires exclusive `PostgresWriteBarrier` advisory lock.
    2. Drains active writers and asserts zero active collections.
    3. Runs `pg_dump` to file `backup.sql`.
    4. Parses artifact hashes referenced in dump and copies exact files to `backup/artifacts/`.
    5. Writes `backup_manifest.json` with SHA-256 of `backup.sql` and all artifact files.
    6. Releases advisory lock.
  * `src/storage/backup/restore-service.ts`:
    1. Verifies `backup_manifest.json` checksums.
    2. Restores PostgreSQL database from `backup.sql`.
    3. Restores artifact files into clean `data/artifacts/`.
    4. Executes `ReconstructionService` on fixture run to prove integrity.

#### Step 7.2: End-to-End Test Suite
* **Test File:** `tests/e2e/non-llm-statistical-forecast.test.ts`
  * **Test 1 (Full Generic Forecasting Run):**
    1. Creates Organization, Project, and frozen Contract (cutoff = $T_0$, resolution = $T_1$).
    2. Stages historical time-series CSV (`available_from < T_0`).
    3. Executes ARIMA container via Rootless Podman (networkless, bounded tmpfs).
    4. Collects `forecast.json` $\to$ preallocates publication ID $\to$ builds & commits run reconstruction manifest $\to$ inserts publication.
    5. At $T_1$, stages ground truth outcome CSV $\to$ resolves outcome to `SETTLED`.
    6. Executes evaluation run $\to$ computes MAPE and RMSE $\to$ persists `evaluation_runs`.
    7. Asserts 100% complete run without any prompt, agent, role, model, or finance field.
* **Test File:** `tests/e2e/offline-reconstruction.test.ts`
  * **Test 1:** Takes the completed run from previous test $\to$ runs `ReconstructionService` in isolated offline sandbox with network and Podman disabled $\to$ asserts byte-for-byte cryptographic reconstruction passes.
* **Test File:** `tests/e2e/disaster-recovery.test.ts`
  * **Test 1:** Runs `BackupService` $\to$ wipes PostgreSQL database and artifact folder $\to$ runs `RestoreService` $\to$ executes offline reconstruction on restored state $\to$ asserts 100% fidelity.

---

## 5. Execution Order & TDD Roadmap

```text
Step 01: Scaffold package.json, tsconfig.json, ESLint, Prettier, check-tsdoc, check-arch.
Step 02: Implement core branded identifiers, lifecycle types, and typed domain errors.
Step 03: Implement RFC 8785 canonical JSON and SHA-256 utilities with unit tests.
Step 04: Implement CutoffPolicy and AuthorizationPolicy with unit tests.
Step 05: Implement LocalArtifactStore with atomic fsync-rename and materializeVerified tests.
Step 06: Write PostgreSQL migration 001_initial_schema.sql and test migration execution.
Step 07: Implement PostgresPool and PostgresWriteBarrier with advisory lock tests.
Step 08: Implement PostgresStorageRepository and PostgresExecutionRepository.
Step 09: Implement PostgresOutcomeRepository (row lock) and PostgresEvaluationRepository.
Step 10: Implement LibpodClient (Unix socket) and StreamDemuxer with bounding tests.
Step 11: Implement RootlessPodmanRuntime and ImageAdmission; run Podman hardening and entrypoint-contract conformance tests.
Step 12: Implement TwoSlotSemaphore and run concurrency admission tests.
Step 13: Implement ArtifactStager, OutputCollector, and ExecutionBroker.
Step 14: Implement StartupReconciler and run orphan container/dangling state crash tests.
Step 15: Implement ManifestBuilder and offline ReconstructionService.
Step 16: Implement BackupService and RestoreService with disaster recovery tests.
Step 17: Execute Full End-to-End Non-LLM Statistical Forecasting Pipeline.
Step 18: Run full CI test suite (lint, typecheck, check-tsdoc, check-arch, unit, int, conf, e2e).
```
