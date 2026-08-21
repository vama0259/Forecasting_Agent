/**
 * Purpose: Historical run reconstruction and point-in-time audit engine.
 * Responsibility: Reconstruct exact execution graph, lineage, and cutoff integrity.
 * Inputs/outputs: RunId; returns ReconstructedRun lineage report or throws error.
 * Excludes: Live container orchestration and database migrations.
 */

import type { PostgresPool } from '../adapters/postgres/postgres-pool.js';
import type { StorageRepository } from '../core/ports/storage-repository.port.js';
import type {
  EvaluationRepository,
  EvaluationRunRecord,
} from '../core/ports/evaluation-repository.port.js';
import type {
  PublicationRecord,
  RunAttemptRecord,
  RunRecord,
} from '../core/ports/storage-repository.port.js';
import type { ContractDeclaration } from '../core/types/contracts.js';
import type { ExecutionRecord } from '../core/ports/execution-repository.port.js';
import type {
  ArtifactVersionId,
  RunId,
  Sha256Hash,
} from '../core/types/identifiers.js';
import { assertEvidenceEligible } from '../core/policies/cutoff-policy.js';
import { canonicalize } from '../core/utils/canonical-json.js';
import { sha256Hex } from '../core/utils/crypto-hash.js';

/** Full point-in-time reconstructed execution lineage and verification record. */
export interface ReconstructedRun {
  readonly run: RunRecord;
  readonly contract: ContractDeclaration;
  readonly attempt: RunAttemptRecord;
  readonly executions: readonly ExecutionRecord[];
  readonly publications: readonly PublicationRecord[];
  readonly evaluations: readonly EvaluationRunRecord[];
  readonly lineageHash: Sha256Hash;
}

/**
 * Reconstructs and cryptographically audits historical run lineages.
 */
export class ReconstructionEngine {
  private readonly storageRepo: StorageRepository;
  private readonly evaluationRepo: EvaluationRepository;
  private readonly pool: PostgresPool;

  /**
   * Initializes reconstruction engine with database pool and repositories.
   * Sets local references for graph traversal.
   */
  constructor(
    storageRepo: StorageRepository,
    evaluationRepo: EvaluationRepository,
    pool: PostgresPool,
  ) {
    this.storageRepo = storageRepo;
    this.evaluationRepo = evaluationRepo;
    this.pool = pool;
  }

  /**
   * Reconstructs historical run execution graph and verifies point-in-time cutoff.
   * Returns ReconstructedRun graph with canonical lineage hash.
   */
  async reconstructRun(runId: RunId): Promise<ReconstructedRun> {
    const run = await this.storageRepo.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const contractRes = await this.pool.query<ContractDeclaration>(
      'SELECT * FROM contracts WHERE id = $1',
      [run.contract_id],
    );
    const contract = contractRes.rows[0];
    if (!contract) {
      throw new Error(`Contract not found: ${run.contract_id}`);
    }

    const attemptsRes = await this.pool.query<RunAttemptRecord>(
      'SELECT * FROM run_attempts WHERE run_id = $1 ORDER BY attempt_number ASC',
      [runId],
    );
    const attempt = attemptsRes.rows[0];
    if (!attempt) {
      throw new Error(`No run attempt found for run: ${runId}`);
    }

    const executionsRes = await this.pool.query<ExecutionRecord>(
      'SELECT * FROM executions WHERE run_attempt_id = $1 ORDER BY created_at ASC',
      [attempt.id],
    );
    const executions = executionsRes.rows;

    for (const exec of executions) {
      const inputsRes = await this.pool.query<{
        artifact_version_id: string;
      }>(
        'SELECT artifact_version_id FROM execution_inputs ' + 'WHERE execution_id = $1',
        [exec.id],
      );
      for (const input of inputsRes.rows) {
        const version = await this.storageRepo.getArtifactVersion(
          input.artifact_version_id as ArtifactVersionId,
        );
        if (version) {
          assertEvidenceEligible(version.available_from, run.cutoff_at, version.state);
        }
      }
    }

    const pub = await this.storageRepo.getPublicationByRunId(runId);
    const publications = pub ? [pub] : [];
    const evaluations: EvaluationRunRecord[] = [];

    if (pub) {
      const pubEvals = await this.evaluationRepo.getEvaluationsForPublication(pub.id);
      evaluations.push(...pubEvals);
    }

    const canonicalPayload = {
      runId: run.id,
      contractHash: contract.contract_hash,
      attemptNumber: attempt.attempt_number,
      planHash: attempt.plan_hash,
      executions: executions.map((e) => ({
        id: e.id,
        state: e.state,
        authorizationHash: e.authorization_hash,
      })),
      publications: publications.map((p) => ({
        id: p.id,
        reconstructionManifestVersionId: p.reconstruction_manifest_version_id,
      })),
      evaluations: evaluations.map((ev) => ({
        id: ev.id,
        definitionHash: ev.definition_hash,
      })),
    };

    const canonicalJson = canonicalize(canonicalPayload);
    const lineageHash = sha256Hex(Buffer.from(canonicalJson)) as Sha256Hash;

    return {
      run,
      contract,
      attempt,
      executions,
      publications,
      evaluations,
      lineageHash,
    };
  }
}
