---
type: adr
date: 2026-08-21
status: decided
parent: "[[Forecasting Agent]]"
---

# General Evidence Storage Foundation

**Companion ADR:** [`2026-08-21-general-docker-sandbox-design.md`](./2026-08-21-general-docker-sandbox-design.md)

## 1. Decision

Build a local-first, domain-neutral evidence store for forecasting workflows. PostgreSQL owns metadata and state; a content-addressed local filesystem owns immutable bytes. One TypeScript application is the only canonical writer.

This is a greenfield foundation. Existing TCS, finance, M8, debate, agent-role, prompt, model, and harness concepts may inform failure lessons only. They do not define this schema, its fixtures, or its acceptance tests.

The foundation records what ran, what it consumed, what it produced, what was published, what outcome was observed, and how an evaluation was calculated. It does not implement an industry adapter, forecasting method, evaluator, user interface, distributed system, or enterprise multi-tenancy.

## 2. Startup scope

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

## 3. Boundaries

```text
Application use cases
  -> StorageRepository port -> PostgreSQL adapter
  -> ArtifactStore port     -> LocalArtifactStore adapter
  -> WriteBarrier port      -> LocalWriteBarrier adapter
```

The core uses plain domain values and ports. It does not import PostgreSQL, filesystem, Docker, model-provider, or industry libraries.

Suggested modules:

```text
src/
├── core/          identifiers, states, policies, ports
├── storage/       persistence use cases and reconstruction
├── adapters/      PostgreSQL and local-filesystem implementations
└── app/           composition root
```

These are modules in one process, not services.

## 4. Universal concepts

Use neutral names:

```text
organizations
  id, slug, display_name, created_at

principals
  id, organization_id, external_subject, display_name, status, created_at

projects
  id, organization_id, slug, display_name, created_at

contracts
  id, organization_id, project_id, version
  input_schema JSONB, output_schema JSONB
  cutoff_policy JSONB, resolution_policy JSONB, evaluation_policy JSONB
  status: DRAFT | FROZEN | RETIRED
  contract_hash, frozen_at, created_at

execution_contracts
  id, organization_id, project_id, version
  input_declarations JSONB, output_declarations JSONB, resource_policy JSONB
  status: DRAFT | FROZEN | RETIRED
  contract_hash, frozen_at, created_at

runs
  id, organization_id, project_id, contract_id, requested_by
  cutoff_at, resolve_after, state: OPEN | PUBLISHED | ABANDONED
  created_at

run_attempts
  id, organization_id, run_id, attempt_number
  plan JSONB, plan_hash
  state: PENDING | RUNNING | SUCCEEDED | FAILED | ABANDONED
  failure_code, failure_detail, started_at, ended_at, created_at

executions
  id, organization_id, run_attempt_id, execution_kind
  execution_contract_id, authorization_hash
  runtime_digest, platform_digest
  state, failure_stage, failure_code, failure_detail, exit_code
  cleanup_state, cleanup_attempts, started_at, ended_at, created_at

execution_authorizations
  id, organization_id, execution_id UNIQUE
  authorization_hash, nonce_hash, expires_at, redeemed_at nullable
  authorization_payload JSONB, created_at

execution_events
  id, organization_id, run_id nullable, execution_id nullable
  principal_id nullable, event_type, details JSONB, occurred_at
```

`execution_kind` is free text. The universal model has no agent roles, rounds, prompts, skills, providers, models, finance fields, or fixed workflow protocol. Use-case-specific metadata is stored as typed artifacts governed by the frozen contract.

Execution contracts contain only runtime input/output declarations and enforceable resource policy. They do not describe forecasting logic. Authorization payloads are immutable canonical JSON; the stored authorization hash covers the complete payload, and redemption is a one-time state transition in the same transaction as the provisioning event.

## 5. Artifacts and lineage

```text
artifacts
  id, organization_id, project_id, kind, logical_name, sensitivity, created_at

artifact_versions
  id, organization_id, artifact_id, version
  state: STAGED | AVAILABLE | REJECTED
  content_sha256, content_bytes, media_type, storage_key
  available_from, observed_at nullable, source_published_at nullable
  retrieved_at, produced_by_execution_id nullable, metadata JSONB, created_at

artifact_edges
  id, organization_id, parent_version_id, child_version_id, relation, created_at

execution_inputs
  organization_id, execution_id, artifact_version_id, purpose, created_at
```

Artifact kinds are an extensible registry, not a database enum. The foundation initially needs `raw_input`, `structured_input`, `structured_output`, `source_code`, `log`, `authorization`, `evaluation`, and `reconstruction_manifest`. A contract may require additional kinds without changing universal tables.

Available bytes and metadata are immutable. Corrections create new versions. Artifact content uses SHA-256 over exact bytes. Structured contract, plan, and manifest hashes use SHA-256 over RFC 8785 canonical JSON.

## 6. ArtifactStore

```ts
interface ArtifactStore {
  stage(input: ReadableStream<Uint8Array>, expected?: ExpectedContent): Promise<StagedObject>;
  commit(staged: StagedObject): Promise<CommittedObject>;
  open(key: ArtifactKey): Promise<ReadableStream<Uint8Array>>;
  exists(key: ArtifactKey): Promise<boolean>;
}
```

Local layout:

```text
data/artifacts/<organization-id>/sha256/<first-two-hex>/<full-sha256>
```

Writes stream to a same-filesystem temporary file, compute the hash, validate expected size/hash, `fsync`, and atomically rename. Insert `AVAILABLE` metadata only after the rename. Trusted code derives every path; callers cannot submit filesystem paths.

## 7. Point-in-time rule

An input is eligible only when:

```text
same organization
same project
state == AVAILABLE
available_from <= run.cutoff_at
```

`available_from` is the earliest time the exact bytes were demonstrably retrievable by this installation. A trusted connector may use a verified publication timestamp; otherwise it uses retrieval completion. Manual backdating is forbidden and the derivation method is stored.

## 8. Publication, outcomes, and evaluation records

```text
publications
  id, organization_id, run_id UNIQUE, run_attempt_id
  contract_hash, payload JSONB, payload_hash
  reconstruction_manifest_version_id, published_at

outcome_versions
  id, organization_id, publication_id, version
  state: PROVISIONAL | SETTLED | DISPUTED | VOID
  payload JSONB, source_artifact_version_id
  resolver_version, superseded_by nullable, created_at

evaluation_runs
  id, organization_id, publication_id, outcome_version_id
  definition_hash, implementation_versions JSONB
  metrics JSONB, baseline_metrics JSONB, created_at
```

The foundation treats payloads as opaque JSON validated against frozen schemas by a later use-case module. One publication is allowed per run. Only the current `SETTLED` outcome may receive a final evaluation.

## 9. Reconstruction

Every published run has a manifest containing universal fields:

- organization, project, run, attempt, and execution IDs;
- frozen contract and plan hashes;
- runtime/platform digests and lifecycle events;
- exact input and output artifact IDs, versions, hashes, sizes, and lineage;
- publication, current outcome, and evaluation references when present;
- failures, retries, degradation decisions, and cleanup results.

Optional evidence is contract-driven. Prompts, skills, models, tools, approvals, generated code, or any future type appears only when the frozen contract requires it. Their absence cannot invalidate an unrelated workflow.

Publication validates only the universal manifest fields plus artifact kinds marked required by the frozen contract. Reconstruction verifies retained evidence; it does not rerun external systems.

## 10. Consistency and failures

- Retries create new attempts and never overwrite history.
- Byte commit precedes the metadata transaction that makes an artifact version available.
- Required output validation, lineage insertion, and execution completion occur in one metadata transaction.
- Collection failure never produces a completed execution.
- Cleanup state is independent so cleanup failure cannot erase valid evidence.
- Concurrent publication must result in exactly one winner through a database constraint.

## 11. Backup and restore

The local application owns a global write barrier covering connectors, artifact staging/commit, collection, reconciliation, publication, outcome resolution, and evaluation writes.

Backup procedure:

1. reject new writes and drain active writers;
2. verify no execution is collecting;
3. copy immutable artifact bytes;
4. dump PostgreSQL while the barrier remains held;
5. create a manifest binding the dump to every referenced artifact hash;
6. release the barrier;
7. restore into an empty database and artifact directory;
8. verify every referenced byte and reconstruct a neutral fixture run.

A test deliberately attempts a concurrent artifact commit during backup and proves it blocks until the barrier is released.

## 12. Scaling gates

Before customer organization two: composite tenant keys, forced RLS, separate database roles, tenant-isolated object/encryption keys, cross-tenant attack tests, export/deletion, and backup isolation are mandatory.

Before multiple application hosts: shared object storage, transactional outbox, worker leases, shared queue, and distributed write coordination are mandatory.

Before the first industry adapter: define a `DomainAdapter` port in the forecasting layer. Its implementation supplies schemas, connectors, resolution rules, and evaluation definitions in a separate package. Storage does not implement or import it.

## 13. Acceptance criteria

- A neutral fixture stores and reconstructs a complete run without prompt/model/agent fields.
- Future-dated evidence is rejected at the cutoff boundary.
- Exact bytes, structured documents, and manifests verify against their correct hash rules.
- Concurrent publication yields one immutable publication.
- Failed attempt one remains reconstructable after attempt two begins.
- Missing or modified artifact bytes fail visibly.
- A disputed outcome cannot receive a final evaluation.
- Backup blocks a concurrent writer and a clean restore reconstructs the fixture.
- No universal schema, fixture, or test contains an industry field or fixed forecasting protocol.

## 14. Decision summary

Use PostgreSQL plus a local content-addressed artifact store behind narrow ports. Preserve immutable evidence, cutoff integrity, lineage, retries, publication locking, outcome versioning, evaluation records, and reconstruction. Keep all industry and forecasting-method knowledge outside this foundation.

## Review log

- 2026-08-21: Initial adversarial review rejected legacy agent/LLM fields, universally mandatory prompt/tool evidence, undefined signing claims, inconsistent backup, and unsupported disk quotas.
- 2026-08-21: Greenfield rewrite removed those assumptions; cross-spec review then found and resolved missing execution-contract and authorization records.
