/**
 * Purpose: PostgreSQL implementation of EvaluationRepository port.
 * Responsibility: Persist forecast evaluation runs gated on SETTLED outcome state.
 * Inputs/outputs: Evaluation run parameters; returns persisted EvaluationRunRecords.
 * Excludes: Dynamic metric calculation algorithms.
 */

import type {
  EvaluationRepository,
  EvaluationRunRecord,
} from '../../core/ports/evaluation-repository.port.js';
import type {
  EvaluationRunId,
  OrganizationId,
  OutcomeVersionId,
  PublicationId,
  Sha256Hash,
} from '../../core/types/identifiers.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL adapter for forecast evaluation persistence with state gating.
 */
export class PostgresEvaluationRepository implements EvaluationRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes PostgreSQL evaluation repository with pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Inserts an evaluation run record, gated on outcome version state being SETTLED.
   * Returns created EvaluationRunRecord or throws if outcome is not SETTLED.
   */
  async createFinalEvaluation(params: {
    readonly id?: EvaluationRunId;
    readonly organization_id: OrganizationId;
    readonly publication_id: PublicationId;
    readonly outcome_version_id: OutcomeVersionId;
    readonly definition_hash: Sha256Hash;
    readonly implementation_versions: Record<string, unknown>;
    readonly metrics: Record<string, unknown>;
    readonly baseline_metrics: Record<string, unknown>;
  }): Promise<EvaluationRunRecord> {
    return this.pool.withTransaction(async (client) => {
      const pubLock = await client.query(
        'SELECT id FROM publications WHERE id = $1 FOR UPDATE',
        [params.publication_id],
      );

      if (pubLock.rows.length === 0) {
        throw new Error(`Publication not found: ${params.publication_id}`);
      }

      const outcomeRes = await client.query<{ id: string; state: string }>(
        `SELECT id, state FROM outcome_versions
         WHERE publication_id = $1
         ORDER BY version DESC LIMIT 1`,
        [params.publication_id],
      );

      const latestOutcome = outcomeRes.rows[0];
      if (!latestOutcome) {
        throw new Error(
          `No outcome version found for publication: ${params.publication_id}`,
        );
      }

      if (latestOutcome.id !== params.outcome_version_id) {
        throw new Error(
          `Requested outcome version ${params.outcome_version_id} does not ` +
            `match latest outcome version ${latestOutcome.id}`,
        );
      }

      if (latestOutcome.state !== 'SETTLED') {
        throw new Error(
          `Cannot create final evaluation: outcome state is ` +
            `"${latestOutcome.state}", required "SETTLED"`,
        );
      }

      const insertRes = await client.query<EvaluationRunRecord>(
        `INSERT INTO evaluation_runs (
           id, organization_id, publication_id, outcome_version_id,
           definition_hash, implementation_versions, metrics, baseline_metrics
         ) VALUES (
           COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8
         )
         RETURNING id, organization_id, publication_id, outcome_version_id,
                   definition_hash, implementation_versions, metrics,
                   baseline_metrics, created_at::text`,
        [
          params.id ?? null,
          params.organization_id,
          params.publication_id,
          params.outcome_version_id,
          params.definition_hash,
          JSON.stringify(params.implementation_versions),
          JSON.stringify(params.metrics),
          JSON.stringify(params.baseline_metrics),
        ],
      );

      const row = insertRes.rows[0];
      if (!row) throw new Error('Failed to insert evaluation run');
      return row;
    });
  }

  /**
   * Retrieves evaluation runs for a publication.
   * Returns list of EvaluationRunRecords.
   */
  async getEvaluationsForPublication(
    publicationId: PublicationId,
  ): Promise<readonly EvaluationRunRecord[]> {
    const res = await this.pool.query<EvaluationRunRecord>(
      `SELECT id, organization_id, publication_id, outcome_version_id,
              definition_hash, implementation_versions, metrics,
              baseline_metrics, created_at::text
       FROM evaluation_runs
       WHERE publication_id = $1
       ORDER BY created_at ASC`,
      [publicationId],
    );
    return res.rows;
  }
}
