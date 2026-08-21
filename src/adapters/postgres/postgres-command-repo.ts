/**
 * Purpose: PostgreSQL persistence adapter for execution commands and outputs.
 * Responsibility: Execute SQL statements inserting commands and output records.
 * Inputs/outputs: Command lists and output descriptors; returns OutputRecords.
 * Excludes: Container runtime communication and process execution.
 */

import type {
  ExecutionOutputRecord,
  // record
} from '../../core/ports/execution-repository.port.js';
import type {
  ArtifactVersionId,
  ExecutionId,
  OrganizationId,
} from '../../core/types/identifiers.js';
import type { ExecutionCommandDeclaration } from '../../core/types/execution.js';
import type { ArtifactDisposition } from '../../core/types/artifacts.js';
import { computeCommandSetHash } from '../../core/policies/authorization-policy.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL repository for execution commands and outputs.
 */
export class PostgresCommandRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes command repository with PostgreSQL pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
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
    for (const cmd of commands) {
      const hash = computeCommandSetHash([cmd]);
      await this.pool.query(
        `INSERT INTO execution_commands (
           organization_id, execution_id, command_sequence, argv,
           working_directory, environment, stdin_artifact_version_id,
           timeout_ms, command_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          organizationId,
          executionId,
          cmd.command_sequence,
          JSON.stringify(cmd.argv),
          cmd.working_directory,
          JSON.stringify(cmd.environment),
          cmd.stdin_artifact_version_id,
          cmd.timeout_ms,
          hash,
        ],
      );
    }
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
    const res = await this.pool.query<ExecutionOutputRecord>(
      `INSERT INTO execution_outputs (
         organization_id, execution_id, artifact_version_id, disposition,
         declaration_name, publishable
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, execution_id, artifact_version_id,
                 disposition, declaration_name, publishable, created_at::text`,
      [
        output.organization_id,
        output.execution_id,
        output.artifact_version_id,
        output.disposition,
        output.declaration_name ?? null,
        output.publishable ?? true,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert execution output');
    return row;
  }
}
