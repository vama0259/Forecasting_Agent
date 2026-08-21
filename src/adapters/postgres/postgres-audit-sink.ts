/**
 * Purpose: PostgreSQL implementation of AuditSink port for execution events.
 * Responsibility: Append immutable audit records with monotonic sequence numbers.
 * Inputs/outputs: AuditEventInput payloads; returns ordered AuditEventRecords.
 * Excludes: Event subscription and real-time streaming sockets.
 */

import type {
  AuditEventInput,
  AuditEventRecord,
  AuditSink,
} from '../../core/ports/audit-sink.port.js';
import type {
  ExecutionId,
  OrganizationId,
  PrincipalId,
  RunId,
} from '../../core/types/identifiers.js';
import type { PostgresPool } from './postgres-pool.js';

interface RawEventRow {
  readonly id: string;
  readonly event_sequence: string;
  readonly organization_id: OrganizationId;
  readonly run_id: RunId | null;
  readonly execution_id: ExecutionId | null;
  readonly principal_id: PrincipalId | null;
  readonly event_type: string;
  readonly details: Record<string, unknown>;
  readonly occurred_at: string;
}

/**
 * PostgreSQL adapter for append-only audit event persistence.
 */
export class PostgresAuditSink implements AuditSink {
  private readonly pool: PostgresPool;

  /**
   * Initializes PostgreSQL audit sink with database pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Appends an immutable audit event to the append-only event log.
   * Returns AuditEventRecord with the generated monotonically increasing sequence.
   */
  async appendEvent(event: AuditEventInput): Promise<AuditEventRecord> {
    const res = await this.pool.query<RawEventRow>(
      `INSERT INTO execution_events (
         organization_id, run_id, execution_id, principal_id, event_type,
         details
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, event_sequence::text, organization_id, run_id,
                 execution_id, principal_id, event_type, details,
                 occurred_at::text`,
      [
        event.organization_id,
        event.run_id ?? null,
        event.execution_id ?? null,
        event.principal_id ?? null,
        event.event_type,
        JSON.stringify(event.details),
      ],
    );

    const row = res.rows[0];
    if (!row) throw new Error('Failed to append audit event');

    return {
      id: row.id,
      event_sequence: BigInt(row.event_sequence),
      organization_id: row.organization_id,
      run_id: row.run_id,
      execution_id: row.execution_id,
      principal_id: row.principal_id,
      event_type: row.event_type,
      details: row.details,
      occurred_at: row.occurred_at,
    };
  }

  /**
   * Retrieves ordered audit events associated with a specific execution.
   * Returns list of AuditEventRecords in strictly ascending sequence order.
   */
  async getEventsForExecution(
    executionId: ExecutionId,
  ): Promise<readonly AuditEventRecord[]> {
    const res = await this.pool.query<RawEventRow>(
      `SELECT id, event_sequence::text, organization_id, run_id, execution_id,
              principal_id, event_type, details, occurred_at::text
       FROM execution_events
       WHERE execution_id = $1
       ORDER BY event_sequence ASC`,
      [executionId],
    );

    return res.rows.map((row) => ({
      id: row.id,
      event_sequence: BigInt(row.event_sequence),
      organization_id: row.organization_id,
      run_id: row.run_id,
      execution_id: row.execution_id,
      principal_id: row.principal_id,
      event_type: row.event_type,
      details: row.details,
      occurred_at: row.occurred_at,
    }));
  }
}
