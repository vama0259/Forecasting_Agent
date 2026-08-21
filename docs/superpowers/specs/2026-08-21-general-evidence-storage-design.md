---
type: adr
date: 2026-08-21
status: decided
parent: "[[Forecasting Agent]]"
---

# General Evidence Storage Foundation

**Companion ADR:** [`2026-08-21-general-oci-sandbox-design.md`](./2026-08-21-general-oci-sandbox-design.md)

## 1. Decision

Build a local-first, domain-neutral evidence store for forecasting workflows. PostgreSQL owns metadata and state; a content-addressed local filesystem owns immutable bytes. One Node.js/TypeScript application is the only canonical writer and trusted control plane.

This is a greenfield foundation. Existing TCS, finance, M8, debate, agent-role, prompt, model, and harness concepts may inform failure lessons only. They do not define this schema, its fixtures, or its acceptance tests.

The foundation records what ran, what it consumed, what it produced, what was published, what outcome was observed, and how an evaluation was calculated. It does not implement an industry adapter, forecasting method, evaluator, user interface, distributed system, or enterprise multi-tenancy.

## 2. Technology and version baseline

As verified on 2026-08-21:

- Node.js `24.19.0` LTS for the trusted host;
- TypeScript `7.0.2` stable with strict compiler settings;
- pnpm `11.22.0` stable and a committed frozen lockfile;
- PostgreSQL `18.4`, pinned to an immutable container digest for local development;
- ECMAScript modules only.

Node is the only component here with an LTS designation. TypeScript and pnpm follow stable releases; PostgreSQL follows its supported major and current minor policy. Exact dependency versions are recorded in `pnpm-lock.yaml`; production and CI installs use `pnpm install --frozen-lockfile`. Container images use immutable digests and never `latest` tags.

Patch releases may be adopted after tests pass. Node LTS, PostgreSQL major, TypeScript major, pnpm major, Podman major, and workload-language major upgrades require an explicit compatibility change with migration/conformance evidence. The specification records this verified baseline; implementation lockfiles and image digests remain the executable source of truth.

## 3. Startup scope

Build now:

- one local installation and one organization;
- PostgreSQL metadata;
- local immutable artifact bytes;
- executions, inputs, outputs, events, forecasts, outcomes, evaluations, and reconstruction manifests;
- point-in-time evidence enforcement;
- backup and restore with a global write barrier.

Defer:

- PostgreSQL RLS, per-tenant encryption, billing, retention automation, S3/MinIO, queues, Kubernetes, microVMs, WORM, and multiple application hosts;
- concrete domain adapters and metric implementations;
- deterministic replay of external models.

## 4. Boundaries

```text
Application use cases
  -> StorageRepository port -> PostgreSQL adapter
  -> ArtifactStore port     -> LocalArtifactStore adapter
  -> WriteBarrier port      -> LocalWriteBarrier adapter
```

The core uses plain domain values and ports. It does not import PostgreSQL, filesystem, Podman, Docker, model-provider, or industry libraries.

The Node.js event loop owns orchestration, streaming, database calls, Podman control, cancellation, and backpressure. CPU-heavy forecasting, parsing, model inference, and numerical work must run in bounded execution containers rather than block the trusted host.

Suggested modules:

```text
src/
├── core/          identifiers, states, policies, ports
├── storage/       persistence use cases and reconstruction
├── adapters/      PostgreSQL and local-filesystem implementations
└── app/           composition root
```

These are modules in one process, not services.

## 5. Universal concepts

Use neutral names:

```text
organizations
  id, slug, display_name, created_at

principals
  id, organization_id, display_name, status, created_at

projects
  id, organization_id, slug, display_name, created_at

contracts
  id, organization_id, project_id, version
  input_schema JSONB, output_schema JSONB
  cutoff_policy JSONB, resolution_policy JSONB, evaluation_policy JSONB
  status: DRAFT | FROZEN | RETIRED
  contract_hash, frozen_at, created_at
  UNIQUE (project_id, version)

execution_contracts
  id, organization_id, project_id, version
  input_declarations JSONB, output_declarations JSONB, resource_policy JSONB
  status: DRAFT | FROZEN | RETIRED
  contract_hash, frozen_at, created_at
  UNIQUE (project_id, version)

runs
  id, organization_id, project_id, contract_id, requested_by
  cutoff_at, resolve_after, state: OPEN | PUBLISHED | ABANDONED
  created_at

run_attempts
  id, organization_id, run_id, attempt_number
  plan JSONB, plan_hash
  state: PENDING | RUNNING | SUCCEEDED | FAILED | ABANDONED
  failure_code, failure_detail, started_at, ended_at, created_at
  UNIQUE (run_id, attempt_number)

executions
  id, organization_id, run_attempt_id, execution_kind
  execution_contract_id, authorization_hash
  runtime_digest, platform_digest
  state: AUTHORIZED | PROVISIONING | READY | RUNNING | COLLECTING | COMPLETED |
         REJECTED | FAILED | CANCELLED | TIMED_OUT | COLLECTION_FAILED | QUARANTINED
  cleanup_state: PENDING | RUNNING | COMPLETED | FAILED
  failure_stage, failure_code, failure_detail, exit_code
  cleanup_attempts, provisioning_deadline nullable
  started_at, ended_at, created_at

execution_authorizations
  id, organization_id, execution_id UNIQUE
  authorization_hash, expires_at, redeemed_at nullable
  authorization_payload JSONB, created_at

execution_events
  id, event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE
  organization_id, run_id nullable, execution_id nullable
  principal_id nullable, event_type, details JSONB, occurred_at

execution_commands
  id, organization_id, execution_id, command_sequence
  argv JSONB, working_directory, environment JSONB
  stdin_artifact_version_id nullable, timeout_ms, command_hash
  started_at, ended_at, exit_code nullable, failure_code nullable
  UNIQUE (execution_id, command_sequence)
```

`execution_kind` is free text. The universal model has no agent roles, rounds, prompts, skills, providers, models, finance fields, or fixed workflow protocol. Use-case-specific metadata is stored as typed artifacts governed by the frozen contract.

Execution contracts contain only runtime input/output declarations and enforceable resource policy. They do not describe forecasting logic. Authorization payloads are immutable canonical JSON; the stored authorization hash covers the complete payload, and redemption is a one-time state transition in the same transaction as the provisioning event.

`run_attempts.plan` is versioned canonical JSON with only `schema_version`, execution IDs/kinds, dependency edges, execution-contract hashes, required input/output declaration names, and degradation policy. It does not contain industry logic. Each authorization additionally binds `command_set_hash`, computed over the ordered canonical `execution_commands` records. Commands store the exact argv array, working directory, effective non-secret environment, optional stdin artifact, timeout, and result. Shell text is never reconstructed from a lossy log representation.

## 6. Artifacts and lineage

```text
artifacts
  id, organization_id, project_id, kind, logical_name, sensitivity, created_at

artifact_versions
  id, organization_id, artifact_id, version
  state: STAGED | AVAILABLE | REJECTED
  content_sha256, content_bytes, media_type, storage_key
  available_from, observed_at nullable, source_published_at nullable
  retrieved_at, produced_by_execution_id nullable, metadata JSONB, created_at
  UNIQUE (artifact_id, version)

artifact_edges
  id, organization_id, parent_version_id, child_version_id, relation, created_at

execution_inputs
  organization_id, execution_id, artifact_version_id, purpose, created_at
  UNIQUE (execution_id, artifact_version_id, purpose)

execution_outputs
  organization_id, execution_id, artifact_version_id
  disposition: DECLARED | DIAGNOSTIC
  declaration_name nullable, publishable, created_at
  UNIQUE (execution_id, declaration_name) WHERE disposition = DECLARED
```

Artifact kinds are an extensible registry, not a database enum. The foundation initially needs `raw_input`, `structured_input`, `structured_output`, `source_code`, `log`, `authorization`, `evaluation`, and `reconstruction_manifest`. A contract may require additional kinds without changing universal tables.

Available bytes and metadata are immutable. Corrections create new versions. Artifact content uses SHA-256 over exact bytes. Structured contract, plan, and manifest hashes use SHA-256 over RFC 8785 canonical JSON.

## 7. ArtifactStore

```ts
interface ArtifactStore {
  stage(input: ReadableStream<Uint8Array>, expected?: ExpectedContent): Promise<StagedObject>;
  commit(staged: StagedObject): Promise<CommittedObject>;
  materializeVerified(key: ArtifactKey, expected: ExpectedContent, destination: StagingPath): Promise<VerifiedFile>;
  exists(key: ArtifactKey): Promise<boolean>;
}
```

Local layout:

```text
data/artifacts/<organization-id>/sha256/<first-two-hex>/<full-sha256>
```

Writes stream to a same-filesystem temporary file, compute the hash, validate expected size/hash, `fsync`, and atomically rename. Insert `AVAILABLE` metadata only after the rename. Trusted code derives every path; callers cannot submit filesystem paths.

Reads used for execution, reconstruction, export, or evaluation go through `materializeVerified`. It streams into a trusted temporary file, verifies exact byte count and SHA-256 before exposing the file, then atomically promotes it into the caller's staging area. Missing, short, long, or hash-mismatched content raises a typed corruption error and no consumer receives an unverified path. Verification remains disk-streaming and never buffers the complete artifact in Node.js memory.

## 8. Point-in-time rule

An input is eligible only when:

```text
same organization
same project
state == AVAILABLE
available_from <= run.cutoff_at
```

`available_from` is the earliest time the exact bytes were demonstrably retrievable by this installation. A trusted connector may use a verified publication timestamp; otherwise it uses retrieval completion. Manual backdating is forbidden. `artifact_versions.metadata.availability_derivation` stores the rule (`VERIFIED_PUBLICATION` or `RETRIEVAL_COMPLETION`), the source timestamp used, connector version, and supporting source-artifact reference.

## 9. Publication, outcomes, and evaluation records

```text
publications
  id, organization_id, run_id UNIQUE, run_attempt_id
  contract_hash, payload JSONB, payload_hash
  reconstruction_manifest_version_id, published_at

outcome_versions
  id, organization_id, publication_id, version
  state: PROVISIONAL | SETTLED | DISPUTED | VOID
  payload JSONB, source_artifact_version_id
  resolver_version, created_at
  UNIQUE (publication_id, version)

evaluation_runs
  id, organization_id, publication_id, outcome_version_id
  definition_hash, implementation_versions JSONB
  metrics JSONB, baseline_metrics JSONB, created_at
```

The foundation treats payloads as opaque JSON validated against frozen schemas by a later use-case module. One publication is allowed per run. The four outcome states are a universal evidence-finality lifecycle, not a forecasting workflow protocol. The current outcome is the greatest version number for that publication; only when that version is `SETTLED` may it receive a final evaluation.

`OutcomeRepository.appendVersion` and `EvaluationRepository.createFinal` both lock the publication row in their PostgreSQL transactions. Final evaluation then selects the greatest outcome version, requires that its ID equals the requested `outcome_version_id` and its state is `SETTLED`, and inserts the evaluation. No unrestricted repository insert exists. A concurrent correction either commits first and causes evaluation rejection or waits until the evaluation transaction commits.

## 10. Reconstruction

Every published run has a manifest containing universal fields:

- organization, project, run, attempt, and execution IDs;
- frozen contract and plan hashes;
- runtime/platform digests and lifecycle events;
- exact input and output artifact IDs, versions, hashes, sizes, and lineage;
- the preallocated publication ID and publication payload hash;
- failures, retries, degradation decisions, and cleanup results.

Optional evidence is contract-driven. Prompts, skills, models, tools, approvals, generated code, or any future type appears only when the frozen contract requires it. Their absence cannot invalidate an unrelated workflow.

Publication preallocates its ID, builds and commits the run reconstruction manifest containing that ID and the payload hash, then inserts the publication row referencing the committed manifest in the publication transaction. The run manifest is immutable and does not claim to contain future outcomes or evaluations. Each later outcome and evaluation record points back to the publication and retains its own payload, hashes, implementation versions, and source-artifact references.

Publication validates only the universal manifest fields plus artifact kinds marked required by the frozen contract. Reconstruction verifies retained evidence; it does not rerun external systems. `event_sequence`, not timestamp, defines deterministic event order.

## 11. Consistency and failures

- Retries create new attempts and never overwrite history.
- Byte commit precedes the metadata transaction that makes an artifact version available.
- Required output validation, lineage insertion, and execution completion occur in one metadata transaction.
- Collection failure never produces a completed execution.
- Cleanup state is independent so cleanup failure cannot erase valid evidence.
- Concurrent publication must result in exactly one winner through a database constraint.

## 12. Backup and restore

The local application owns a global host read/write barrier covering connectors, artifact staging/commit, collection, reconciliation, publication, outcome resolution, and evaluation writes. Every write unit holds the host barrier in shared mode from before its first byte/state change through its final database commit. A `BEFORE STATEMENT` trigger on every mutable application table also calls one shared-lock function for the fixed `BACKUP_WRITE_BARRIER` PostgreSQL advisory key. This makes database participation automatic even if repository code forgets an explicit call. The migration role owns schema changes, and the one canonical TypeScript application role is the only runtime role allowed to mutate application tables.

Backup procedure:

1. acquire the host barrier exclusively, rejecting new writers and draining active writers;
2. on a dedicated database session, acquire the exclusive `BACKUP_WRITE_BARRIER` advisory lock;
3. verify no execution is collecting;
4. dump PostgreSQL while both barriers remain held;
5. copy exactly the immutable artifact keys referenced by that dump;
6. create and verify a manifest binding the dump to every referenced artifact hash;
7. release the database lock, then the host barrier;
8. restore into an empty database and artifact directory;
9. verify every referenced byte and reconstruct a neutral fixture run.

A test deliberately attempts writes through a second database connection and a concurrent artifact commit during backup and proves both block until the barrier is released. Crash before the verified backup manifest is committed leaves an incomplete backup that restore refuses.

## 13. Scaling gates

Before customer organization two: composite tenant keys, forced RLS, separate database roles, tenant-isolated object/encryption keys, cross-tenant attack tests, export/deletion, and backup isolation are mandatory.

Before multiple application hosts: shared object storage, transactional outbox, worker leases, shared queue, and distributed write coordination are mandatory.

Before the first industry adapter: define a `DomainAdapter` port in the forecasting layer. Its implementation supplies schemas, connectors, resolution rules, and evaluation definitions in a separate package. Storage does not implement or import it.

## 14. Acceptance criteria

- A neutral fixture stores and reconstructs a complete run without prompt/model/agent fields.
- Future-dated evidence is rejected at the cutoff boundary.
- Exact bytes, structured documents, and manifests verify against their correct hash rules.
- Concurrent publication yields one immutable publication.
- Failed attempt one remains reconstructable after attempt two begins.
- Missing or modified artifact bytes fail visibly.
- A disputed outcome cannot receive a final evaluation.
- A concurrent outcome correction prevents evaluation against a stale settled version.
- Backup blocks a concurrent writer and a clean restore reconstructs the fixture.
- No universal schema, fixture, or test contains an industry field or fixed forecasting protocol.
- Large artifact reads/writes are streaming and demonstrate backpressure without buffering the complete payload in Node.js memory.
- Exact argv, environment, working directory, timeout, stdin artifact, and result are reconstructible for every executed command.

## 15. Decision summary

Use PostgreSQL plus a local content-addressed artifact store behind narrow ports. Preserve immutable evidence, cutoff integrity, lineage, retries, publication locking, outcome versioning, evaluation records, and reconstruction. Keep all industry and forecasting-method knowledge outside this foundation.

## Review log

- 2026-08-21: Initial adversarial review rejected legacy agent/LLM fields, universally mandatory prompt/tool evidence, undefined signing claims, inconsistent backup, and unsupported disk quotas.
- 2026-08-21: Greenfield rewrite removed those assumptions; cross-spec review then found and resolved missing execution-contract and authorization records.
- 2026-08-21: External re-review aligned lifecycle enums, added declared-output bindings and deterministic event order, removed unused local identity/nonce/pointer fields, and resolved publication-manifest ordering.
- 2026-08-21: Trusted control plane fixed as Node.js 24 LTS with TypeScript; exact stable tool/database baselines and upgrade gates added.
- 2026-08-21: Final integrity pass defined reconstructible commands/plans, verified reads, enforceable final evaluation, explicit availability provenance, database-backed backup coordination, and crash-safe backup ordering.
