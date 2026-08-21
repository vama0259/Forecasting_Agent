/**
 * Purpose: Consumer-owned port interface for metadata storage and domain entities.
 * Responsibility: Define CRUD operations for orgs, projects, contracts, runs.
 * Inputs/outputs: Domain entity records and query filters; returns persisted records.
 * Excludes: Direct SQL query building and connection pool management.
 */

import type {
  ArtifactId,
  ArtifactVersionId,
  ContractId,
  OrganizationId,
  ProjectId,
  PublicationId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../types/identifiers.js';
import type {
  ArtifactRecord,
  ArtifactVersionMetadata,
  ArtifactVersionRecord,
} from '../types/artifacts.js';
import type {
  ContractDeclaration,
  ExecutionContractDeclaration,
} from '../types/contracts.js';
import type {
  ArtifactVersionState,
  RunAttemptState,
  RunState,
} from '../types/lifecycle.js';
import type { CanonicalPlan } from '../types/execution.js';

/** Organization record. */
export interface OrganizationRecord {
  readonly id: OrganizationId;
  readonly slug: string;
  readonly display_name: string;
  readonly created_at: string;
}

/** Project record. */
export interface ProjectRecord {
  readonly id: ProjectId;
  readonly organization_id: OrganizationId;
  readonly slug: string;
  readonly display_name: string;
  readonly created_at: string;
}

/** Forecast run record. */
export interface RunRecord {
  readonly id: RunId;
  readonly organization_id: OrganizationId;
  readonly project_id: ProjectId;
  readonly contract_id: ContractId;
  readonly requested_by: string;
  readonly cutoff_at: string;
  readonly resolve_after: string;
  readonly state: RunState;
  readonly created_at: string;
}

/** Run attempt record. */
export interface RunAttemptRecord {
  readonly id: RunAttemptId;
  readonly organization_id: OrganizationId;
  readonly run_id: RunId;
  readonly attempt_number: number;
  readonly plan: CanonicalPlan;
  readonly plan_hash: Sha256Hash;
  readonly state: RunAttemptState;
  readonly failure_code: string | null;
  readonly failure_detail: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

/** Publication record. */
export interface PublicationRecord {
  readonly id: PublicationId;
  readonly organization_id: OrganizationId;
  readonly run_id: RunId;
  readonly run_attempt_id: RunAttemptId;
  readonly contract_hash: Sha256Hash;
  readonly payload: Record<string, unknown>;
  readonly payload_hash: Sha256Hash;
  readonly reconstruction_manifest_version_id: ArtifactVersionId;
  readonly published_at: string;
}

/**
 * Interface defining persistence operations for core forecasting domain entities.
 */
export interface StorageRepository {
  /**
   * Inserts a new organization record.
   * Returns created OrganizationRecord or throws on conflict.
   */
  createOrganization(org: {
    readonly id?: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<OrganizationRecord>;

  /**
   * Inserts a new project record scoped to an organization.
   * Returns created ProjectRecord or throws on conflict.
   */
  createProject(project: {
    readonly id?: ProjectId;
    readonly organization_id: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<ProjectRecord>;

  /**
   * Inserts or retrieves an immutable forecast contract declaration.
   * Returns persisted ContractDeclaration record.
   */
  createContract(
    contract: Omit<ContractDeclaration, 'created_at'>,
  ): Promise<ContractDeclaration>;

  /**
   * Inserts or retrieves an immutable execution contract declaration.
   * Returns persisted ExecutionContractDeclaration record.
   */
  createExecutionContract(
    contract: Omit<ExecutionContractDeclaration, 'created_at'>,
  ): Promise<ExecutionContractDeclaration>;

  /**
   * Inserts a new forecasting run record.
   * Returns created RunRecord in OPEN state.
   */
  createRun(run: {
    readonly id?: RunId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly contract_id: ContractId;
    readonly requested_by: string;
    readonly cutoff_at: string;
    readonly resolve_after: string;
    readonly state?: RunState;
  }): Promise<RunRecord>;

  /**
   * Retrieves a run record by its unique ID.
   * Returns RunRecord or null if not found.
   */
  getRun(runId: RunId): Promise<RunRecord | null>;

  /**
   * Inserts a new run attempt record with canonical plan and plan hash.
   * Returns created RunAttemptRecord.
   */
  createRunAttempt(attempt: {
    readonly id?: RunAttemptId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly attempt_number: number;
    readonly plan: CanonicalPlan;
    readonly plan_hash: Sha256Hash;
    readonly state?: RunAttemptState;
  }): Promise<RunAttemptRecord>;

  /**
   * Updates state, timestamps, and failure details for a run attempt.
   * Returns updated RunAttemptRecord.
   */
  updateRunAttemptState(
    id: RunAttemptId,
    state: RunAttemptState,
    failureCode?: string | null,
    failureDetail?: string | null,
  ): Promise<RunAttemptRecord>;

  /**
   * Inserts a new logical artifact record.
   * Returns created ArtifactRecord.
   */
  createArtifact(artifact: {
    readonly id?: ArtifactId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly kind: string;
    readonly logical_name: string;
    readonly sensitivity?: string;
  }): Promise<ArtifactRecord>;

  /**
   * Inserts an immutable artifact version with content hash and size.
   * Returns created ArtifactVersionRecord.
   */
  createArtifactVersion(version: {
    readonly id?: ArtifactVersionId;
    readonly organization_id: OrganizationId;
    readonly artifact_id: ArtifactId;
    readonly version: number;
    readonly state: ArtifactVersionState;
    readonly content_sha256: Sha256Hash;
    readonly content_bytes: number;
    readonly media_type: string;
    readonly storage_key: string;
    readonly available_from: string;
    readonly observed_at?: string | null;
    readonly source_published_at?: string | null;
    readonly retrieved_at: string;
    readonly produced_by_execution_id?: string | null;
    readonly metadata?: ArtifactVersionMetadata;
  }): Promise<ArtifactVersionRecord>;

  /**
   * Retrieves an immutable artifact version by ID.
   * Returns ArtifactVersionRecord or null if not found.
   */
  getArtifactVersion(id: ArtifactVersionId): Promise<ArtifactVersionRecord | null>;

  /**
   * Inserts a publication record, enforcing run_id uniqueness.
   * Returns created PublicationRecord or throws on unique constraint violation.
   */
  createPublication(publication: {
    readonly id?: PublicationId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly run_attempt_id: RunAttemptId;
    readonly contract_hash: Sha256Hash;
    readonly payload: Record<string, unknown>;
    readonly payload_hash: Sha256Hash;
    readonly reconstruction_manifest_version_id: ArtifactVersionId;
  }): Promise<PublicationRecord>;

  /**
   * Retrieves a publication record associated with a run ID.
   * Returns PublicationRecord or null if unpublished.
   */
  getPublicationByRunId(runId: RunId): Promise<PublicationRecord | null>;

  /**
   * Retrieves every attempt recorded for a run, ordered by attempt number.
   * Returns full RunAttemptRecord history, including abandoned attempts.
   */
  getRunAttemptsForRun(runId: RunId): Promise<readonly RunAttemptRecord[]>;

  /**
   * Retrieves the artifact version IDs an execution declared as inputs.
   * Returns array of ArtifactVersionId for reconstruction and lineage.
   */
  getExecutionInputs(
    executionId: string,
  ): Promise<readonly { artifact_version_id: ArtifactVersionId }[]>;

  /**
   * Retrieves lineage edges where the given version is the child.
   * Returns array of parent ArtifactVersionId and relation pairs.
   */
  getArtifactEdgesForVersion(
    childVersionId: ArtifactVersionId,
  ): Promise<readonly { parent_version_id: ArtifactVersionId; relation: string }[]>;
}
