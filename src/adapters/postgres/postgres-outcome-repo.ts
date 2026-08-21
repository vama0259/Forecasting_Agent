/**
 * Purpose: PostgreSQL implementation of OutcomeRepository with row-level locks.
 * Responsibility: Append outcome versions serialized on publication row locks.
 * Inputs/outputs: Outcome payloads; returns persisted OutcomeVersionRecords.
 * Excludes: Statistical metric scoring and dispute resolution logic.
 */

import type {
  OutcomeRepository,
  OutcomeVersionRecord,
} from '../../core/ports/outcome-repository.port.js';
import type {
  ArtifactVersionId,
  OrganizationId,
  PublicationId,
} from '../../core/types/identifiers.js';
import type { OutcomeState } from '../../core/types/lifecycle.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL adapter for outcome version persistence with publication row locking.
 */
export class PostgresOutcomeRepository implements OutcomeRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes PostgreSQL outcome repository with pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Appends a new outcome version under an exclusive publication row lock.
   * Returns created OutcomeVersionRecord with incremented version number.
   */
  async appendOutcomeVersion(params: {
    readonly organization_id: OrganizationId;
    readonly publication_id: PublicationId;
    readonly state: OutcomeState;
    readonly payload: Record<string, unknown>;
    readonly source_artifact_version_id: ArtifactVersionId;
    readonly resolver_version: string;
  }): Promise<OutcomeVersionRecord> {
    return this.pool.withTransaction(async (client) => {
      const pubLock = await client.query(
        'SELECT id FROM publications WHERE id = $1 FOR UPDATE',
        [params.publication_id],
      );

      if (pubLock.rows.length === 0) {
        throw new Error(`Publication not found: ${params.publication_id}`);
      }

      const versionRes = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM outcome_versions WHERE publication_id = $1`,
        [params.publication_id],
      );
      const nextVersion = versionRes.rows[0]?.next_version ?? 1;

      const insertRes = await client.query<OutcomeVersionRecord>(
        `INSERT INTO outcome_versions (
           organization_id, publication_id, version, state, payload,
           source_artifact_version_id, resolver_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, organization_id, publication_id, version, state, payload,
                   source_artifact_version_id, resolver_version,
                   created_at::text`,
        [
          params.organization_id,
          params.publication_id,
          nextVersion,
          params.state,
          JSON.stringify(params.payload),
          params.source_artifact_version_id,
          params.resolver_version,
        ],
      );

      const row = insertRes.rows[0];
      if (!row) throw new Error('Failed to insert outcome version');
      return row;
    });
  }

  /**
   * Retrieves the latest outcome version for a given publication.
   * Returns greatest version OutcomeVersionRecord or null if no outcome exists.
   */
  async getLatestOutcomeVersion(
    publicationId: PublicationId,
  ): Promise<OutcomeVersionRecord | null> {
    const res = await this.pool.query<OutcomeVersionRecord>(
      `SELECT id, organization_id, publication_id, version, state, payload,
              source_artifact_version_id, resolver_version, created_at::text
       FROM outcome_versions
       WHERE publication_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [publicationId],
    );
    return res.rows[0] ?? null;
  }
}
