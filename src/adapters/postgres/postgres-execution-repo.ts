/**
 * Purpose: PostgreSQL implementation of ExecutionRepository port.
 * Responsibility: Manage execution lifecycle states, commands, and authorizations.
 * Inputs/outputs: Execution parameters, state transitions; returns execution records.
 * Excludes: Container engine API calls and process signal handling.
 */

import type {
  ExecutionCommandRecord,
  ExecutionOutputRecord,
  ExecutionRecord,
  ExecutionRepository,
} from '../../core/ports/execution-repository.port.js';
import type {
  ArtifactVersionId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  RunAttemptId,
  Sha256Hash,
} from '../../core/types/identifiers.js';
import type { CleanupState, ExecutionState } from '../../core/types/lifecycle.js';
import type {
  AuthorizationPayload,
  ExecutionCommandDeclaration,
} from '../../core/types/execution.js';
import type { ArtifactDisposition } from '../../core/types/artifacts.js';
import type { PostgresPool } from './postgres-pool.js';
import { PostgresCommandRepository } from './postgres-command-repo.js';
import { PostgresAuthorizationRepository } from './postgres-auth-repo.js';

/**
 * PostgreSQL adapter managing containerized execution state and authorizations.
 */
export class PostgresExecutionRepository implements ExecutionRepository {
  private readonly pool: PostgresPool;
  private readonly commandRepo: PostgresCommandRepository;
  private readonly authRepo: PostgresAuthorizationRepository;

  /**
   * Initializes execution repository with PostgreSQL pool instance.
   * Sets local pool and sub-repository references.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
    this.commandRepo = new PostgresCommandRepository(pool);
    this.authRepo = new PostgresAuthorizationRepository(pool);
  }

  /**
   * Creates an execution record and stores its one-time authorization payload.
   * Returns created ExecutionRecord in AUTHORIZED state.
   */
  async createExecutionWithAuthorization(params: {
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
  }): Promise<ExecutionRecord> {
    return this.authRepo.createExecutionWithAuthorization(params);
  }

  /**
   * Redeems authorization atomically and transitions execution to PROVISIONING.
   * Returns updated ExecutionRecord or throws AuthorizationError if invalid/expired.
   */
  async redeemAuthorization(
    executionId: ExecutionId,
    expectedHash: Sha256Hash,
  ): Promise<ExecutionRecord> {
    return this.authRepo.redeemAuthorization(executionId, expectedHash);
  }

  /**
   * Updates the execution lifecycle state and optional failure metadata.
   * Returns updated ExecutionRecord.
   */
  async updateExecutionState(
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
  ): Promise<ExecutionRecord> {
    const res = await this.pool.query<ExecutionRecord>(
      `UPDATE executions
       SET state = $2,
           failure_stage = COALESCE($3, failure_stage),
           failure_code = COALESCE($4, failure_code),
           failure_detail = COALESCE($5, failure_detail),
           exit_code = COALESCE($6, exit_code),
           started_at = COALESCE($7::timestamptz, started_at),
           ended_at = COALESCE($8::timestamptz, ended_at)
       WHERE id = $1
       RETURNING id, organization_id, run_attempt_id, execution_kind,
                 execution_contract_id, authorization_hash, runtime_digest,
                 platform_digest, state, cleanup_state, failure_stage,
                 failure_code, failure_detail, exit_code, cleanup_attempts,
                 provisioning_deadline::text, started_at::text, ended_at::text,
                 created_at::text`,
      [
        executionId,
        state,
        metadata?.failure_stage ?? null,
        metadata?.failure_code ?? null,
        metadata?.failure_detail ?? null,
        metadata?.exit_code ?? null,
        metadata?.started_at ?? null,
        metadata?.ended_at ?? null,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`Execution not found: ${executionId}`);
    return row;
  }

  /**
   * Updates execution cleanup state.
   * Returns updated ExecutionRecord.
   */
  async updateCleanupState(
    executionId: ExecutionId,
    cleanupState: CleanupState,
  ): Promise<ExecutionRecord> {
    const res = await this.pool.query<ExecutionRecord>(
      `UPDATE executions
       SET cleanup_state = $2,
           cleanup_attempts = cleanup_attempts + 1
       WHERE id = $1
       RETURNING id, organization_id, run_attempt_id, execution_kind,
                 execution_contract_id, authorization_hash, runtime_digest,
                 platform_digest, state, cleanup_state, failure_stage,
                 failure_code, failure_detail, exit_code, cleanup_attempts,
                 provisioning_deadline::text, started_at::text, ended_at::text,
                 created_at::text`,
      [executionId, cleanupState],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`Execution not found: ${executionId}`);
    return row;
  }

  /**
   * Records execution commands.
   * Resolves when command records are inserted.
   */
  async recordCommands(
    executionId: ExecutionId,
    organizationId: OrganizationId,
    commands: readonly ExecutionCommandDeclaration[],
  ): Promise<void> {
    return this.commandRepo.recordCommands(executionId, organizationId, commands);
  }

  /**
   * Records an output artifact produced by an execution.
   * Returns created ExecutionOutputRecord.
   */
  async recordOutput(output: {
    readonly organization_id: OrganizationId;
    readonly execution_id: ExecutionId;
    readonly artifact_version_id: ArtifactVersionId;
    readonly disposition: ArtifactDisposition;
    readonly declaration_name?: string | null;
    readonly publishable?: boolean;
  }): Promise<ExecutionOutputRecord> {
    return this.commandRepo.recordOutput(output);
  }

  /**
   * Retrieves an execution record by ID.
   * Returns ExecutionRecord or null if not found.
   */
  async getExecution(executionId: ExecutionId): Promise<ExecutionRecord | null> {
    const res = await this.pool.query<ExecutionRecord>(
      `SELECT id, organization_id, run_attempt_id, execution_kind,
              execution_contract_id, authorization_hash, runtime_digest,
              platform_digest, state, cleanup_state, failure_stage,
              failure_code, failure_detail, exit_code, cleanup_attempts,
              provisioning_deadline::text, started_at::text, ended_at::text,
              created_at::text
       FROM executions WHERE id = $1`,
      [executionId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Queries executions currently in active non-terminal states.
   * Returns array of active ExecutionRecords for crash reconciliation.
   */
  async getActiveExecutions(): Promise<readonly ExecutionRecord[]> {
    const res = await this.pool.query<ExecutionRecord>(
      `SELECT id, organization_id, run_attempt_id, execution_kind,
              execution_contract_id, authorization_hash, runtime_digest,
              platform_digest, state, cleanup_state, failure_stage,
              failure_code, failure_detail, exit_code, cleanup_attempts,
              provisioning_deadline::text, started_at::text, ended_at::text,
              created_at::text
       FROM executions
       WHERE state IN ('PROVISIONING', 'READY', 'RUNNING', 'COLLECTING')`,
    );
    return res.rows;
  }

  /**
   * Retrieves all executions belonging to a run attempt, in creation order.
   * Returns array of ExecutionRecords for reconstruction and audit.
   */
  async getExecutionsForAttempt(
    runAttemptId: RunAttemptId,
  ): Promise<readonly ExecutionRecord[]> {
    const res = await this.pool.query<ExecutionRecord>(
      `SELECT id, organization_id, run_attempt_id, execution_kind,
              execution_contract_id, authorization_hash, runtime_digest,
              platform_digest, state, cleanup_state, failure_stage,
              failure_code, failure_detail, exit_code, cleanup_attempts,
              provisioning_deadline::text, started_at::text, ended_at::text,
              created_at::text
       FROM executions
       WHERE run_attempt_id = $1
       ORDER BY created_at ASC`,
      [runAttemptId],
    );
    return res.rows;
  }

  /**
   * Retrieves every recorded command for an execution, ordered by sequence.
   * Returns array of ExecutionCommandRecords for reconstruction verification.
   */
  async getCommandsForExecution(
    executionId: ExecutionId,
  ): Promise<readonly ExecutionCommandRecord[]> {
    return this.commandRepo.getCommandsForExecution(executionId);
  }

  /**
   * Retrieves every recorded output for an execution, in creation order.
   * Returns array of ExecutionOutputRecords for reconstruction verification.
   */
  async getOutputsForExecution(
    executionId: ExecutionId,
  ): Promise<readonly ExecutionOutputRecord[]> {
    return this.commandRepo.getOutputsForExecution(executionId);
  }
}
