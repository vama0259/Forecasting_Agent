/**
 * Purpose: Consumer-owned port interface for execution lifecycle and commands.
 * Responsibility: Define operations for authorizations, execution states, and outputs.
 * Inputs/outputs: Execution payloads, state transitions, output declarations; records.
 * Excludes: Container runtime management and raw socket communication.
 */

import type {
  ArtifactVersionId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  RunAttemptId,
  Sha256Hash,
} from '../types/identifiers.js';
import type { CleanupState, ExecutionState } from '../types/lifecycle.js';
import type {
  AuthorizationPayload,
  ExecutionCommandDeclaration,
} from '../types/execution.js';
import type { ArtifactDisposition } from '../types/artifacts.js';

/** Execution record. */
export interface ExecutionRecord {
  readonly id: ExecutionId;
  readonly organization_id: OrganizationId;
  readonly run_attempt_id: RunAttemptId;
  readonly execution_kind: string;
  readonly execution_contract_id: ExecutionContractId;
  readonly authorization_hash: Sha256Hash;
  readonly runtime_digest: string;
  readonly platform_digest: string;
  readonly state: ExecutionState;
  readonly cleanup_state: CleanupState;
  readonly failure_stage: string | null;
  readonly failure_code: string | null;
  readonly failure_detail: string | null;
  readonly exit_code: number | null;
  readonly cleanup_attempts: number;
  readonly provisioning_deadline: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

/** Execution authorization record. */
export interface ExecutionAuthorizationRecord {
  readonly id: string;
  readonly organization_id: OrganizationId;
  readonly execution_id: ExecutionId;
  readonly authorization_hash: Sha256Hash;
  readonly expires_at: string;
  readonly redeemed_at: string | null;
  readonly authorization_payload: AuthorizationPayload;
  readonly created_at: string;
}

/** Execution output record. */
export interface ExecutionOutputRecord {
  readonly id: string;
  readonly organization_id: OrganizationId;
  readonly execution_id: ExecutionId;
  readonly artifact_version_id: ArtifactVersionId;
  readonly disposition: ArtifactDisposition;
  readonly declaration_name: string | null;
  readonly publishable: boolean;
  readonly created_at: string;
}

/** Persisted execution command record, including its content hash. */
export interface ExecutionCommandRecord {
  readonly id: string;
  readonly organization_id: OrganizationId;
  readonly execution_id: ExecutionId;
  readonly command_sequence: number;
  readonly argv: readonly string[];
  readonly working_directory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin_artifact_version_id: ArtifactVersionId | null;
  readonly timeout_ms: number;
  readonly command_hash: string;
  readonly created_at: string;
}

/**
 * Interface defining persistence operations for containerized execution lifecycles.
 */
export interface ExecutionRepository {
  /**
   * Creates an execution record and stores its one-time authorization payload.
   * Returns created ExecutionRecord in AUTHORIZED state.
   */
  createExecutionWithAuthorization(params: {
    readonly execution: {
      readonly id?: ExecutionId;
      readonly organization_id: OrganizationId;
      readonly run_attempt_id: RunAttemptId;
      readonly execution_kind: string;
      readonly execution_contract_id: ExecutionContractId;
      readonly authorization_hash: Sha256Hash;
      readonly runtime_digest: string;
      readonly platform_digest: string;
      readonly provisioning_deadline?: string | null;
    };
    readonly authorization: {
      readonly authorization_payload: AuthorizationPayload;
      readonly expires_at: string;
    };
  }): Promise<ExecutionRecord>;

  /**
   * Redeems authorization atomically and transitions execution to PROVISIONING.
   * Returns updated ExecutionRecord or throws AuthorizationError if invalid/expired.
   */
  redeemAuthorization(
    executionId: ExecutionId,
    expectedHash: Sha256Hash,
  ): Promise<ExecutionRecord>;

  /**
   * Updates the execution lifecycle state and optional failure metadata.
   * Returns updated ExecutionRecord.
   */
  updateExecutionState(
    executionId: ExecutionId,
    state: ExecutionState,
    metadata?: {
      readonly failure_stage?: string | null;
      readonly failure_code?: string | null;
      readonly failure_detail?: string | null;
      readonly exit_code?: number | null;
      readonly started_at?: string | null;
      readonly ended_at?: string | null;
    },
  ): Promise<ExecutionRecord>;

  /**
   * Updates execution cleanup state.
   * Returns updated ExecutionRecord.
   */
  updateCleanupState(
    executionId: ExecutionId,
    cleanupState: CleanupState,
  ): Promise<ExecutionRecord>;

  /**
   * Records execution commands.
   * Resolves when command records are inserted.
   */
  recordCommands(
    executionId: ExecutionId,
    organizationId: OrganizationId,
    commands: readonly ExecutionCommandDeclaration[],
  ): Promise<void>;

  /**
   * Records an output artifact produced by an execution.
   * Returns created ExecutionOutputRecord.
   */
  recordOutput(output: {
    readonly organization_id: OrganizationId;
    readonly execution_id: ExecutionId;
    readonly artifact_version_id: ArtifactVersionId;
    readonly disposition: ArtifactDisposition;
    readonly declaration_name?: string | null;
    readonly publishable?: boolean;
  }): Promise<ExecutionOutputRecord>;

  /**
   * Retrieves an execution record by ID.
   * Returns ExecutionRecord or null if not found.
   */
  getExecution(executionId: ExecutionId): Promise<ExecutionRecord | null>;

  /**
   * Queries executions currently in active non-terminal states.
   * Returns array of active ExecutionRecords for crash reconciliation.
   */
  getActiveExecutions(): Promise<readonly ExecutionRecord[]>;

  /**
   * Retrieves all executions belonging to a run attempt, in creation order.
   * Returns array of ExecutionRecords for reconstruction and audit.
   */
  getExecutionsForAttempt(
    runAttemptId: RunAttemptId,
  ): Promise<readonly ExecutionRecord[]>;

  /**
   * Retrieves every recorded command for an execution, ordered by sequence.
   * Returns array of ExecutionCommandRecords for reconstruction verification.
   */
  getCommandsForExecution(
    executionId: ExecutionId,
  ): Promise<readonly ExecutionCommandRecord[]>;

  /**
   * Retrieves every recorded output for an execution, in creation order.
   * Returns array of ExecutionOutputRecords for reconstruction verification.
   */
  getOutputsForExecution(
    executionId: ExecutionId,
  ): Promise<readonly ExecutionOutputRecord[]>;
}
