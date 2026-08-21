/**
 * Purpose: Shared FK-safe database cleanup for tests sharing one Postgres instance.
 * Responsibility: Delete every row scoped to one organization, in dependency order.
 * Inputs/outputs: PostgresPool and OrganizationId; resolves when rows are removed.
 * Excludes: Artifact-store byte deletion (each fixture removes its own directory).
 */

import type { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import type { OrganizationId } from '../../src/core/types/identifiers.js';

// Reverse of the foreign-key dependency order every mutable table was created
// in (see migrations/001_initial_schema.sql and RestoreService.INSERT_ORDER):
// children before the parents they reference.
const DELETE_ORDER = [
  'evaluation_runs',
  'outcome_versions',
  'publications',
  'execution_outputs',
  'execution_inputs',
  'artifact_edges',
  'artifact_versions',
  'artifacts',
  'execution_events',
  'execution_commands',
  'execution_authorizations',
  'executions',
  'run_attempts',
  'runs',
  'execution_contracts',
  'contracts',
  'projects',
  'principals',
  'organizations',
] as const;

/**
 * Deletes every row belonging to one organization across all mutable tables,
 * in FK-safe dependency order, inside a single transaction.
 * Resolves once every scoped row has been removed. Every mutable table has
 * an organization_id column except organizations itself, which is deleted
 * last by its own id.
 */
export async function deleteOrganizationCascade(
  pool: PostgresPool,
  organizationId: OrganizationId,
): Promise<void> {
  await pool.withTransaction(async (client) => {
    for (const table of DELETE_ORDER) {
      if (table === 'organizations') {
        await client.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
      } else {
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
          organizationId,
        ]);
      }
    }
  });
}
