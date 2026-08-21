/**
 * Purpose: Consumer-owned port interface for gated forecast evaluation.
 * Responsibility: Define persistence operations for evaluations on settled outcomes.
 * Inputs/outputs: Evaluation metrics, hashes, and implementation versions; records.
 * Excludes: Metric computation algorithms and statistical scoring formulas.
 */

import type {
  EvaluationRunId,
  OrganizationId,
  OutcomeVersionId,
  PublicationId,
  Sha256Hash,
} from '../types/identifiers.js';

/** Representation of an evaluation run record. */
export interface EvaluationRunRecord {
  readonly id: EvaluationRunId;
  readonly organization_id: OrganizationId;
  readonly publication_id: PublicationId;
  readonly outcome_version_id: OutcomeVersionId;
  readonly definition_hash: Sha256Hash;
  readonly implementation_versions: Record<string, unknown>;
  readonly metrics: Record<string, unknown>;
  readonly baseline_metrics: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * Interface defining persistence operations for forecast evaluation runs.
 */
export interface EvaluationRepository {
  /**
   * Inserts an evaluation run record, gated on outcome version state being SETTLED.
   * Returns created EvaluationRunRecord or throws if outcome is not SETTLED.
   */
  createFinalEvaluation(params: {
    readonly id?: EvaluationRunId;
    readonly organization_id: OrganizationId;
    readonly publication_id: PublicationId;
    readonly outcome_version_id: OutcomeVersionId;
    readonly definition_hash: Sha256Hash;
    readonly implementation_versions: Record<string, unknown>;
    readonly metrics: Record<string, unknown>;
    readonly baseline_metrics: Record<string, unknown>;
  }): Promise<EvaluationRunRecord>;

  /**
   * Retrieves evaluation runs for a publication.
   * Returns list of EvaluationRunRecords.
   */
  getEvaluationsForPublication(
    publicationId: PublicationId,
  ): Promise<readonly EvaluationRunRecord[]>;
}
