# Graph Report - generic-forecasting-foundation  (2026-08-21)

## Corpus Check
- Corpus is ~6,829 words - fits in a single context window. You may not need a graph.

## Summary
- 68 nodes · 95 edges · 11 communities (8 shown, 3 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.82)
- Token cost: 0 input · 113,771 output

## Community Hubs (Navigation)
- OCI Sandbox Runtime & Broker
- Evidence Storage & Reconstruction
- Pre-commit Hygiene Config
- Agent Engineering Rules
- Engineering Standards Overview
- Artifact Store & Collection
- Architecture & SOLID Principles
- Documentation & Function Contracts
- File & Line Limits
- Testing & Verification

## God Nodes (most connected - your core abstractions)
1. `General Local OCI Sandbox Foundation` - 20 edges
2. `General Evidence Storage Foundation` - 19 edges
3. `Engineering Standards` - 11 edges
4. `Agent Engineering Rules` - 9 edges
5. `Pre-commit Hook Configuration` - 8 edges
6. `pre-commit/pre-commit-hooks v5.0.0` - 7 edges
7. `Required Reading (rule for agents before writing code)` - 4 edges
8. `Architecture Rules (Clean Architecture, SOLID, composition)` - 4 edges
9. `ArtifactStore Port` - 4 edges
10. `PostgreSQL Adapter` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Enforcement Configuration` --semantically_similar_to--> `Pre-commit Hook Configuration`  [INFERRED] [semantically similar]
  docs/engineering-standards.md → .pre-commit-config.yaml
- `Required Reading (rule for agents before writing code)` --references--> `Engineering Standards`  [EXTRACTED]
  AGENTS.md → docs/engineering-standards.md
- `Required Reading (rule for agents before writing code)` --references--> `General Evidence Storage Foundation`  [EXTRACTED]
  AGENTS.md → docs/superpowers/specs/2026-08-21-general-evidence-storage-design.md
- `Required Reading (rule for agents before writing code)` --references--> `General Local OCI Sandbox Foundation`  [EXTRACTED]
  AGENTS.md → docs/superpowers/specs/2026-08-21-general-oci-sandbox-design.md
- `Architecture Rules (Clean Architecture, SOLID, composition)` --conceptually_related_to--> `Composition over Inheritance`  [INFERRED]
  AGENTS.md → docs/engineering-standards.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Storage Ports and Adapters** — docs_superpowers_specs_2026_08_21_general_evidence_storage_design_storagerepository_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_artifactstore_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_writebarrier_port, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_postgresql_adapter, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_localartifactstore_adapter, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_localwritebarrier_adapter [EXTRACTED 1.00]
- **ExecutionBroker Port Composition** — docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_executionbroker_use_case, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_authorizationverifier_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_artifactstager_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_sandboxruntime_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_outputcollector_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_executionrepository_port, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_auditsink_port [EXTRACTED 1.00]
- **Required Reading Set for Coding Agents** — agents_required_reading, docs_engineering_standards_engineering_standards, docs_superpowers_specs_2026_08_21_general_evidence_storage_design_general_evidence_storage_foundation, docs_superpowers_specs_2026_08_21_general_oci_sandbox_design_general_local_oci_sandbox_foundation [EXTRACTED 1.00]

## Communities (11 total, 3 thin omitted)

### Community 0 - "OCI Sandbox Runtime & Broker"
Cohesion: 0.12
Nodes (17): BACKUP_WRITE_BARRIER (global write barrier), execution_authorizations table, execution_commands table, AuthorizationVerifier Port, BROKER_SINGLETON Advisory Lock, Command Execution, Execution Authorization Mechanism, ExecutionBroker Use Case (+9 more)

### Community 1 - "Evidence Storage & Reconstruction"
Cohesion: 0.17
Nodes (15): DomainAdapter Port (future industry adapter), evaluation_runs table, executions table (lifecycle state model), General Evidence Storage Foundation, LocalWriteBarrier Adapter, outcome_versions table, Point-in-Time Rule (cutoff enforcement), PostgreSQL Adapter (+7 more)

### Community 2 - "Pre-commit Hygiene Config"
Cohesion: 0.46
Nodes (8): check-added-large-files hook (maxkb=500), check-merge-conflict hook, check-yaml hook, detect-private-key hook, end-of-file-fixer hook, Pre-commit Hook Configuration, pre-commit/pre-commit-hooks v5.0.0, trailing-whitespace hook

### Community 3 - "Agent Engineering Rules"
Cohesion: 0.33
Nodes (6): Agent Engineering Rules, Change Discipline, Graphify Codebase Search Practice, Required Reading (rule for agents before writing code), Review Questions, TypeScript Rules

### Community 4 - "Engineering Standards Overview"
Cohesion: 0.40
Nodes (5): Enforcement Configuration, Engineering Standards, Error and Cancellation Rules, Naming and Types, Object-Oriented Design Rules

### Community 5 - "Artifact Store & Collection"
Cohesion: 0.40
Nodes (5): artifact_versions table, ArtifactStore Port, LocalArtifactStore Adapter, ArtifactStager Port, Output Collection

### Community 6 - "Architecture & SOLID Principles"
Cohesion: 0.67
Nodes (4): Architecture Rules (Clean Architecture, SOLID, composition), Composition over Inheritance, Design Hierarchy (order of applying principles), SOLID Principles

## Knowledge Gaps
- **17 isolated node(s):** `Graphify Codebase Search Practice`, `TypeScript Rules`, `Change Discipline`, `Review Questions`, `Object-Oriented Design Rules` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Required Reading (rule for agents before writing code)` connect `Agent Engineering Rules` to `OCI Sandbox Runtime & Broker`, `Evidence Storage & Reconstruction`, `Engineering Standards Overview`?**
  _High betweenness centrality (0.498) - this node is a cross-community bridge._
- **Why does `General Local OCI Sandbox Foundation` connect `OCI Sandbox Runtime & Broker` to `Evidence Storage & Reconstruction`, `Agent Engineering Rules`, `Artifact Store & Collection`?**
  _High betweenness centrality (0.419) - this node is a cross-community bridge._
- **Why does `Engineering Standards` connect `Engineering Standards Overview` to `Agent Engineering Rules`, `Architecture & SOLID Principles`, `Documentation & Function Contracts`, `File & Line Limits`, `Testing & Verification`?**
  _High betweenness centrality (0.415) - this node is a cross-community bridge._
- **What connects `Graphify Codebase Search Practice`, `TypeScript Rules`, `Change Discipline` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `OCI Sandbox Runtime & Broker` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
