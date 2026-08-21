/**
 * Purpose: PostgreSQL persistence adapter for execution authorizations.
 * Responsibility: Execute SQL inserts and atomic one-time authorization redemptions.
 * Inputs/outputs: Authorization parameters; returns ExecutionAuthorization records.
 * Excludes: Container runtime scheduling and process control.
 */

import type {
  ExecutionAuthorizationRecord,
  ExecutionRecord,
} from '../../core/ports/execution-repository.port.js';
import type {
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  RunAttemptId,
  Sha256Hash,
} from '../../core/types/identifiers.js';
import type { AuthorizationPayload } from '../../core/types/execution.js';
import { AuthorizationError } from '../../core/errors/authorization.error.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL repository for execution authorizations and one-time redemptions.
 */
export class PostgresAuthorizationRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes authorization repository with PostgreSQL pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
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
    return this.pool.withTransaction(async (client) => {
      const execRes = await client.query<ExecutionRecord>(
        `INSERT INTO executions (
           id, organization_id, run_attempt_id, execution_kind,
           execution_contract_id, authorization_hash, runtime_digest,
           platform_digest, state, cleanup_state, provisioning_deadline
         ) VALUES (
           COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8,
           'AUTHORIZED', 'PENDING', $9
         )
         RETURNING id, organization_id, run_attempt_id, execution_kind,
                   execution_contract_id, authorization_hash, runtime_digest,
                   platform_digest, state, cleanup_state, failure_stage,
                   failure_code, failure_detail, exit_code, cleanup_attempts,
                   provisioning_deadline::text, started_at::text, ended_at::text,
                   created_at::text`,
        [
          params.execution.id ?? null,
          params.execution.organization_id,
          params.execution.run_attempt_id,
          params.execution.execution_kind,
          params.execution.execution_contract_id,
          params.execution.authorization_hash,
          params.execution.runtime_digest,
          params.execution.platform_digest,
          params.execution.provisioning_deadline ?? null,
        ],
      );

      const execRow = execRes.rows[0];
      if (!execRow) throw new Error('Failed to insert execution');

      await client.query(
        `INSERT INTO execution_authorizations (
           organization_id, execution_id, authorization_hash, expires_at,
           authorization_payload
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          params.execution.organization_id,
          execRow.id,
          params.execution.authorization_hash,
          params.authorization.expires_at,
          JSON.stringify(params.authorization.authorization_payload),
        ],
      );

      return execRow;
    });
  }

  /**
   * Redeems authorization atomically and transitions execution to PROVISIONING.
   * Returns updated ExecutionRecord or throws AuthorizationError if invalid/expired.
   */
  async redeemAuthorization(
    executionId: ExecutionId,
    expectedHash: Sha256Hash,
  ): Promise<ExecutionRecord> {
    return this.pool.withTransaction(async (client) => {
      const authRes = await client.query<ExecutionAuthorizationRecord>(
        `SELECT id, organization_id, execution_id, authorization_hash,
                expires_at::text, redeemed_at::text, authorization_payload,
                created_at::text
         FROM execution_authorizations
         WHERE execution_id = $1 FOR UPDATE`,
        [executionId],
      );

      const auth = authRes.rows[0];
      if (!auth) {
        throw new AuthorizationError('Authorization record not found', {
          executionId,
        });
      }

      if (auth.redeemed_at) {
        throw new AuthorizationError('Authorization already redeemed', {
          executionId,
          redeemedAt: auth.redeemed_at,
        });
      }

      if (new Date(auth.expires_at).getTime() < Date.now()) {
        throw new AuthorizationError('Authorization has expired', {
          executionId,
          expiresAt: auth.expires_at,
        });
      }

      if (auth.authorization_hash !== expectedHash) {
        throw new AuthorizationError('Authorization hash mismatch', {
          executionId,
          expected: expectedHash,
          actual: auth.authorization_hash,
        });
      }

      await client.query(
        `UPDATE execution_authorizations
         SET redeemed_at = NOW() WHERE execution_id = $1`,
        [executionId],
      );

      const execRes = await client.query<ExecutionRecord>(
        `UPDATE executions
         SET state = 'PROVISIONING'
         WHERE id = $1
         RETURNING id, organization_id, run_attempt_id, execution_kind,
                   execution_contract_id, authorization_hash, runtime_digest,
                   platform_digest, state, cleanup_state, failure_stage,
                   failure_code, failure_detail, exit_code, cleanup_attempts,
                   provisioning_deadline::text, started_at::text, ended_at::text,
                   created_at::text`,
        [executionId],
      );

      const updated = execRes.rows[0];
      if (!updated) throw new Error(`Execution not found: ${executionId}`);
      return updated;
    });
  }
}
