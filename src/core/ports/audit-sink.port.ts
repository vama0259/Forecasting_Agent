/**
 * Purpose: Consumer-owned port interface for append-only execution audit logs.
 * Responsibility: Provide monotonic event recording for runtime security events.
 * Inputs/outputs: Structured audit event payloads; returns durable event sequence ID.
 * Excludes: Event streaming, pub/sub broadcasting, and log analytics.
 */

import type {
  ExecutionId,
  OrganizationId,
  PrincipalId,
  RunId,
} from '../types/identifiers.js';

/** Structured event input for persisting to the audit log. */
export interface AuditEventInput {
  readonly organization_id: OrganizationId;
  readonly run_id?: RunId | null;
  readonly execution_id?: ExecutionId | null;
  readonly principal_id?: PrincipalId | null;
  readonly event_type: string;
  readonly details: Record<string, unknown>;
}

/** Record of an immutable audit event stored in the audit log. */
export interface AuditEventRecord {
  readonly id: string;
  readonly event_sequence: bigint;
  readonly organization_id: OrganizationId;
  readonly run_id: RunId | null;
  readonly execution_id: ExecutionId | null;
  readonly principal_id: PrincipalId | null;
  readonly event_type: string;
  readonly details: Record<string, unknown>;
  readonly occurred_at: string;
}

/**
 * Interface defining append-only audit event logging operations.
 */
export interface AuditSink {
  /**
   * Appends an immutable audit event to the append-only event log.
   * Returns AuditEventRecord with the generated monotonically increasing sequence.
   */
  appendEvent(event: AuditEventInput): Promise<AuditEventRecord>;

  /**
   * Retrieves ordered audit events associated with a specific execution.
   * Returns list of AuditEventRecords in strictly ascending sequence order.
   */
  getEventsForExecution(executionId: ExecutionId): Promise<readonly AuditEventRecord[]>;
}
