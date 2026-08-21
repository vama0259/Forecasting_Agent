/**
 * Purpose: Aggregate PostgreSQL repository implementing StorageRepository port.
 * Responsibility: Delegate entity persistence to focused sub-repositories.
 * Inputs/outputs: Domain entity parameters; returns mapped domain records.
 * Excludes: Container runtime management and raw socket communication.
 */

import type {
  OrganizationRecord,
  ProjectRecord,
  PublicationRecord,
  RunAttemptRecord,
  RunRecord,
  StorageRepository,
} from '../../core/ports/storage-repository.port.js';
import type {
  ArtifactRecord,
  ArtifactVersionMetadata,
  ArtifactVersionRecord,
} from '../../core/types/artifacts.js';
import type {
  ContractDeclaration,
  ExecutionContractDeclaration,
} from '../../core/types/contracts.js';
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
} from '../../core/types/identifiers.js';
import type {
  ArtifactVersionState,
  RunAttemptState,
  RunState,
} from '../../core/types/lifecycle.js';
import type { CanonicalPlan } from '../../core/types/execution.js';
import type { PostgresPool } from './postgres-pool.js';
import { PostgresArtifactRepository } from './postgres-artifact-repo.js';
import { PostgresContractRepository } from './postgres-contract-repo.js';
import { PostgresRunRepository } from './postgres-run-repo.js';

/**
 * Composite PostgreSQL storage repository aggregating sub-entity repositories.
 */
export class PostgresStorageRepository implements StorageRepository {
  private readonly artifactRepo: PostgresArtifactRepository;
  private readonly contractRepo: PostgresContractRepository;
  private readonly runRepo: PostgresRunRepository;

  /**
   * Initializes composite repository with PostgreSQL pool instance.
   * Instantiates sub-repositories for artifacts, contracts, and runs.
   */
  constructor(pool: PostgresPool) {
    this.artifactRepo = new PostgresArtifactRepository(pool);
    this.contractRepo = new PostgresContractRepository(pool);
    this.runRepo = new PostgresRunRepository(pool);
  }

  /**
   * Inserts a new organization record.
   * Returns created OrganizationRecord or throws on conflict.
   */
  async createOrganization(org: {
    readonly id?: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<OrganizationRecord> {
    return this.runRepo.createOrganization(org);
  }

  /**
   * Inserts a new project record scoped to an organization.
   * Returns created ProjectRecord or throws on conflict.
   */
  async createProject(project: {
    readonly id?: ProjectId;
    readonly organization_id: OrganizationId;
    readonly slug: string;
    readonly display_name: string;
  }): Promise<ProjectRecord> {
    return this.runRepo.createProject(project);
  }

  /**
   * Inserts or retrieves an immutable forecast contract declaration.
   * Returns persisted ContractDeclaration record.
   */
  async createContract(
    contract: Omit<ContractDeclaration, 'created_at'>,
  ): Promise<ContractDeclaration> {
    return this.contractRepo.createContract(contract);
  }

  /**
   * Inserts or retrieves an immutable execution contract declaration.
   * Returns persisted ExecutionContractDeclaration record.
   */
  async createExecutionContract(
    contract: Omit<ExecutionContractDeclaration, 'created_at'>,
  ): Promise<ExecutionContractDeclaration> {
    return this.contractRepo.createExecutionContract(contract);
  }

  /**
   * Inserts a new forecasting run record.
   * Returns created RunRecord in OPEN state.
   */
  async createRun(run: {
    readonly id?: RunId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly contract_id: ContractId;
    readonly requested_by: string;
    readonly cutoff_at: string;
    readonly resolve_after: string;
    readonly state?: RunState;
  }): Promise<RunRecord> {
    return this.runRepo.createRun(run);
  }

  /**
   * Retrieves a run record by its unique ID.
   * Returns RunRecord or null if not found.
   */
  async getRun(runId: RunId): Promise<RunRecord | null> {
    return this.runRepo.getRun(runId);
  }

  /**
   * Inserts a new run attempt record with canonical plan and plan hash.
   * Returns created RunAttemptRecord.
   */
  async createRunAttempt(attempt: {
    readonly id?: RunAttemptId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly attempt_number: number;
    readonly plan: CanonicalPlan;
    readonly plan_hash: Sha256Hash;
    readonly state?: RunAttemptState;
  }): Promise<RunAttemptRecord> {
    return this.runRepo.createRunAttempt(attempt);
  }

  /**
   * Updates state, timestamps, and failure details for a run attempt.
   * Returns updated RunAttemptRecord.
   */
  async updateRunAttemptState(
    id: RunAttemptId,
    state: RunAttemptState,
    failureCode?: string | null,
    failureDetail?: string | null,
  ): Promise<RunAttemptRecord> {
    return this.runRepo.updateRunAttemptState(id, state, failureCode, failureDetail);
  }

  /**
   * Inserts a new logical artifact record.
   * Returns created ArtifactRecord.
   */
  async createArtifact(artifact: {
    readonly id?: ArtifactId;
    readonly organization_id: OrganizationId;
    readonly project_id: ProjectId;
    readonly kind: string;
    readonly logical_name: string;
    readonly sensitivity?: string;
  }): Promise<ArtifactRecord> {
    return this.artifactRepo.createArtifact(artifact);
  }

  /**
   * Inserts an immutable artifact version with content hash and size.
   * Returns created ArtifactVersionRecord.
   */
  async createArtifactVersion(version: {
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
  }): Promise<ArtifactVersionRecord> {
    return this.artifactRepo.createArtifactVersion(version);
  }

  /**
   * Retrieves an immutable artifact version by ID.
   * Returns ArtifactVersionRecord or null if not found.
   */
  async getArtifactVersion(
    id: ArtifactVersionId,
  ): Promise<ArtifactVersionRecord | null> {
    return this.artifactRepo.getArtifactVersion(id);
  }

  /**
   * Inserts a publication record, enforcing run_id uniqueness.
   * Returns created PublicationRecord or throws on unique constraint violation.
   */
  async createPublication(publication: {
    readonly id?: PublicationId;
    readonly organization_id: OrganizationId;
    readonly run_id: RunId;
    readonly run_attempt_id: RunAttemptId;
    readonly contract_hash: Sha256Hash;
    readonly payload: Record<string, unknown>;
    readonly payload_hash: Sha256Hash;
    readonly reconstruction_manifest_version_id: ArtifactVersionId;
  }): Promise<PublicationRecord> {
    return this.runRepo.createPublication(publication);
  }

  /**
   * Retrieves a publication record associated with a run ID.
   * Returns PublicationRecord or null if unpublished.
   */
  async getPublicationByRunId(runId: RunId): Promise<PublicationRecord | null> {
    return this.runRepo.getPublicationByRunId(runId);
  }

  /**
   * Retrieves every attempt recorded for a run, ordered by attempt number.
   * Returns full RunAttemptRecord history, including abandoned attempts.
   */
  async getRunAttemptsForRun(runId: RunId): Promise<readonly RunAttemptRecord[]> {
    return this.runRepo.getRunAttemptsForRun(runId);
  }

  /**
   * Retrieves the artifact version IDs an execution declared as inputs.
   * Returns array of ArtifactVersionId for reconstruction and lineage.
   */
  async getExecutionInputs(
    executionId: string,
  ): Promise<readonly { artifact_version_id: ArtifactVersionId }[]> {
    return this.artifactRepo.getExecutionInputs(executionId);
  }

  /**
   * Retrieves lineage edges where the given version is the child.
   * Returns array of parent ArtifactVersionId and relation pairs.
   */
  async getArtifactEdgesForVersion(
    childVersionId: ArtifactVersionId,
  ): Promise<readonly { parent_version_id: ArtifactVersionId; relation: string }[]> {
    return this.artifactRepo.getArtifactEdgesForVersion(childVersionId);
  }
}
