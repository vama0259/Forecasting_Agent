# Graph Report - generic-forecasting-foundation  (2026-08-21)

## Corpus Check
- 1 files · ~11,631 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 146 nodes · 262 edges · 11 communities (9 shown, 2 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.84)
- Token cost: 0 input · 95,018 output

## Community Hubs (Navigation)
- Evidence Storage Schema & Ports
- Execution Broker & Podman Adapters
- Agent Engineering Rules
- Database Migration & Tables
- Reconstruction, Backup & E2E Tests
- Core Policies & Repository Ports
- Pre-commit Hygiene Config
- Plan & Companion ADRs
- TSDoc Enforcement Script
- Composition Root

## God Nodes (most connected - your core abstractions)
1. `General Local OCI Sandbox Foundation` - 20 edges
2. `migrations/001_initial_schema.sql` - 20 edges
3. `General Evidence Storage Foundation` - 19 edges
4. `organizations table` - 19 edges
5. `src/adapters/ — Infrastructure Implementations` - 13 edges
6. `Engineering Standards` - 11 edges
7. `src/core/ — Pure Domain Layer` - 10 edges
8. `executions table` - 10 edges
9. `Agent Engineering Rules` - 9 edges
10. `RootlessPodmanRuntime` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Enforcement Configuration` --semantically_similar_to--> `Pre-commit Hook Configuration`  [INFERRED] [semantically similar]
  docs/engineering-standards.md → .pre-commit-config.yaml
- `Required Reading (rule for agents before writing code)` --references--> `General Local OCI Sandbox Foundation`  [EXTRACTED]
  AGENTS.md → docs/superpowers/specs/2026-08-21-general-oci-sandbox-design.md
- `Required Reading (rule for agents before writing code)` --references--> `General Evidence Storage Foundation`  [EXTRACTED]
  AGENTS.md → docs/superpowers/specs/2026-08-21-general-evidence-storage-design.md
- `Architecture Rules (Clean Architecture, SOLID, composition)` --conceptually_related_to--> `Composition over Inheritance`  [INFERRED]
  AGENTS.md → docs/engineering-standards.md
- `Architecture Rules (Clean Architecture, SOLID, composition)` --conceptually_related_to--> `Design Hierarchy (order of applying principles)`  [INFERRED]
  AGENTS.md → docs/engineering-standards.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Seven-Phase Implementation Roadmap** — docs_superpowers_plans_2026_08_21_foundation_implementation_plan_check_architecture_script, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_cutoff_policy, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_local_artifact_store, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_postgres_write_barrier, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_rootless_podman_runtime, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_execution_broker, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_reconstruction_service [INFERRED 0.85]
- **Four Test Suite Tiers (Unit/Integration/Conformance/E2E)** — docs_superpowers_plans_2026_08_21_foundation_implementation_plan_unit_tests, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_integration_tests, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_conformance_tests, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_e2e_tests [EXTRACTED 1.00]
- **core/storage/execution/adapters/app Module Layers** — docs_superpowers_plans_2026_08_21_foundation_implementation_plan_src_core_module, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_src_storage_module, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_src_execution_module, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_src_adapters_module, docs_superpowers_plans_2026_08_21_foundation_implementation_plan_src_app_module [EXTRACTED 1.00]
- **Required Reading Set for Coding Agents** — agents_required_reading, docs_engineering_standards_engineering_standards, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_general_evidence_storage_foundation, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_general_local_oci_sandbox_foundation [EXTRACTED 1.00]
- **Storage Ports and Adapters** — docs_superpowers_specs_2026_08_21_general_evidence_storage_design_storagerepository_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_artifactstore_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_writebarrier_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_postgresql_adapter, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_localartifactstore_adapter, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_localwritebarrier_adapter [EXTRACTED 1.00]
- **ExecutionBroker Port Composition** — docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_executionbroker_use_case, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_authorizationverifier_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_artifactstager_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_sandboxruntime_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_outputcollector_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_executionrepository_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_auditsink_port [EXTRACTED 1.00]

## Communities (11 total, 2 thin omitted)

### Community 0 - "Evidence Storage Schema & Ports"
Cohesion: 0.08
Nodes (36): artifact_versions table, ArtifactStore Port, BACKUP_WRITE_BARRIER (global write barrier), DomainAdapter Port (future industry adapter), evaluation_runs table, execution_authorizations table, execution_commands table, executions table (lifecycle state model) (+28 more)

### Community 1 - "Execution Broker & Podman Adapters"
Cohesion: 0.13
Nodes (26): ArtifactStager, check-architecture.ts (Dependency/Layer Linter), tests/conformance/ — Podman Conformance Test Suite, Entrypoint Contract (PID 1 Must Remain Running), EvaluationUseCase (evaluate-publication.use-case.ts), ExecutionBroker, Execution Order & TDD Roadmap (18 Steps), ExecutionRepository Port (+18 more)

### Community 2 - "Agent Engineering Rules"
Cohesion: 0.13
Nodes (21): Agent Engineering Rules, Architecture Rules (Clean Architecture, SOLID, composition), Change Discipline, Documentation Rules, File and Line Limits, Graphify Codebase Search Practice, Required Reading (rule for agents before writing code), Review Questions (+13 more)

### Community 3 - "Database Migration & Tables"
Cohesion: 0.34
Nodes (20): artifact_edges table, artifact_versions table, artifacts table, contracts table, migrations/001_initial_schema.sql, evaluation_runs table, execution_authorizations table, execution_commands table (+12 more)

### Community 4 - "Reconstruction, Backup & E2E Tests"
Cohesion: 0.18
Nodes (15): BackupService — Advisory Lock + Atomic Snapshot Coordinator, disaster-recovery.test.ts, tests/e2e/ — End-to-End Test Suite, tests/integration/ — Integration Test Suite, ManifestBuilder, offline-reconstruction.test.ts, OutcomeResolutionUseCase (resolve-outcome.use-case.ts), PostgresStorageRepository (+7 more)

### Community 5 - "Core Policies & Repository Ports"
Cohesion: 0.24
Nodes (12): AuditSink Port, AuthorizationPolicy, RFC 8785 Canonical JSON (canonical-json.ts), Streaming SHA-256 Digest (crypto-hash.ts), CutoffPolicy, EvaluationRepository Port, OutcomeRepository Port, PostgresAuditSink (+4 more)

### Community 6 - "Pre-commit Hygiene Config"
Cohesion: 0.46
Nodes (8): check-added-large-files hook (maxkb=500), check-merge-conflict hook, check-yaml hook, detect-private-key hook, end-of-file-fixer hook, Pre-commit Hook Configuration, pre-commit/pre-commit-hooks v5.0.0, trailing-whitespace hook

### Community 7 - "Plan & Companion ADRs"
Cohesion: 0.50
Nodes (4): Engineering Standards, Generic Forecasting Foundation Implementation Plan, General Evidence Storage Design (ADR), General OCI Sandbox Design (ADR)

## Knowledge Gaps
- **25 isolated node(s):** `AuthorizationVerifier Port`, `Filesystem and Quotas`, `Image Policy (digest allowlist)`, `OCI Hardening Controls`, `OutputCollector Port` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `src/adapters/ — Infrastructure Implementations` connect `Execution Broker & Podman Adapters` to `Reconstruction, Backup & E2E Tests`, `Core Policies & Repository Ports`?**
  _High betweenness centrality (0.333) - this node is a cross-community bridge._
- **Why does `General Local OCI Sandbox Foundation` connect `Evidence Storage Schema & Ports` to `Execution Broker & Podman Adapters`, `Agent Engineering Rules`?**
  _High betweenness centrality (0.302) - this node is a cross-community bridge._
- **Why does `Required Reading (rule for agents before writing code)` connect `Agent Engineering Rules` to `Evidence Storage Schema & Ports`?**
  _High betweenness centrality (0.299) - this node is a cross-community bridge._
- **What connects `AuthorizationVerifier Port`, `Filesystem and Quotas`, `Image Policy (digest allowlist)` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Evidence Storage Schema & Ports` be split into smaller, more focused modules?**
  _Cohesion score 0.07936507936507936 - nodes in this community are weakly interconnected._
- **Should `Execution Broker & Podman Adapters` be split into smaller, more focused modules?**
  _Cohesion score 0.12923076923076923 - nodes in this community are weakly interconnected._
- **Should `Agent Engineering Rules` be split into smaller, more focused modules?**
  _Cohesion score 0.12857142857142856 - nodes in this community are weakly interconnected._
