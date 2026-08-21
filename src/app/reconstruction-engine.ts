/**
 * Purpose: Historical run reconstruction and point-in-time audit engine.
 * Responsibility: Reconstruct exact execution graph, lineage, and cutoff integrity.
 * Inputs/outputs: RunId; returns ReconstructedRun lineage report or throws error.
 * Excludes: Live container orchestration and database migrations.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PostgresPool } from '../adapters/postgres/postgres-pool.js';
import type { StorageRepository } from '../core/ports/storage-repository.port.js';
import type {
  EvaluationRepository,
  EvaluationRunRecord,
} from '../core/ports/evaluation-repository.port.js';
import type {
  OutcomeRepository,
  OutcomeVersionRecord,
} from '../core/ports/outcome-repository.port.js';
import type {
  ExecutionRepository,
  ExecutionCommandRecord,
  ExecutionOutputRecord,
} from '../core/ports/execution-repository.port.js';
import type { ArtifactStore } from '../core/ports/artifact-store.port.js';
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

/** Per-execution lineage detail included in a reconstructed attempt. */
export interface ReconstructedExecution {
  readonly execution: ExecutionRecord;
  readonly commands: readonly ExecutionCommandRecord[];
  readonly outputs: readonly ExecutionOutputRecord[];
  readonly inputArtifactVersionIds: readonly ArtifactVersionId[];
}

/** Per-attempt lineage detail: the attempt and its full execution graph. */
export interface ReconstructedAttempt {
  readonly attempt: RunAttemptRecord;
  readonly executions: readonly ReconstructedExecution[];
}

/** Full point-in-time reconstructed execution lineage and verification record. */
export interface ReconstructedRun {
  readonly run: RunRecord;
  readonly contract: ContractDeclaration;
  readonly attempt: RunAttemptRecord;
  readonly attempts: readonly ReconstructedAttempt[];
  readonly executions: readonly ExecutionRecord[];
  readonly publications: readonly PublicationRecord[];
  readonly outcomeVersions: readonly OutcomeVersionRecord[];
  readonly evaluations: readonly EvaluationRunRecord[];
  readonly lineageHash: Sha256Hash;
}

/**
 * Reconstructs and cryptographically audits historical run lineages.
 */
export class ReconstructionEngine {
  private readonly storageRepo: StorageRepository;
  private readonly executionRepo: ExecutionRepository;
  private readonly outcomeRepo: OutcomeRepository;
  private readonly evaluationRepo: EvaluationRepository;
  private readonly artifactStore: ArtifactStore;
  private readonly pool: PostgresPool;

  /**
   * Initializes reconstruction engine with database pool and repositories.
   * Sets local references for graph traversal and byte verification.
   */
  constructor(
    storageRepo: StorageRepository,
    executionRepo: ExecutionRepository,
    outcomeRepo: OutcomeRepository,
    evaluationRepo: EvaluationRepository,
    artifactStore: ArtifactStore,
    pool: PostgresPool,
  ) {
    this.storageRepo = storageRepo;
    this.executionRepo = executionRepo;
    this.outcomeRepo = outcomeRepo;
    this.evaluationRepo = evaluationRepo;
    this.artifactStore = artifactStore;
    this.pool = pool;
  }

  /**
   * Reconstructs the full historical run lineage across every attempt and
   * verifies point-in-time cutoff and exact byte integrity of every input.
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

    const runAttempts = await this.storageRepo.getRunAttemptsForRun(runId);
    if (runAttempts.length === 0) {
      throw new Error(`No run attempt found for run: ${runId}`);
    }

    const attempts: ReconstructedAttempt[] = [];
    for (const runAttempt of runAttempts) {
      attempts.push(await this.reconstructAttempt(runAttempt, run.cutoff_at));
    }

    // The most recent attempt remains the primary `attempt`/`executions`
    // fields for backward-compatible callers; `attempts` carries every one.
    const primaryAttempt = attempts[attempts.length - 1];
    if (!primaryAttempt) {
      throw new Error(`No run attempt found for run: ${runId}`);
    }

    const pub = await this.storageRepo.getPublicationByRunId(runId);
    const publications = pub ? [pub] : [];
    const outcomeVersions = pub
      ? await this.outcomeRepo.getAllOutcomeVersions(pub.id)
      : [];
    const evaluations: EvaluationRunRecord[] = [];

    if (pub) {
      const pubEvals = await this.evaluationRepo.getEvaluationsForPublication(pub.id);
      evaluations.push(...pubEvals);
    }

    const canonicalPayload = {
      runId: run.id,
      contractHash: contract.contract_hash,
      attempts: attempts.map((a) => ({
        attemptNumber: a.attempt.attempt_number,
        planHash: a.attempt.plan_hash,
        state: a.attempt.state,
        executions: a.executions.map((re) => ({
          id: re.execution.id,
          state: re.execution.state,
          authorizationHash: re.execution.authorization_hash,
          runtimeDigest: re.execution.runtime_digest,
          platformDigest: re.execution.platform_digest,
          commands: re.commands.map((c) => c.command_hash),
          outputs: re.outputs.map((o) => ({
            artifactVersionId: o.artifact_version_id,
            disposition: o.disposition,
          })),
          inputArtifactVersionIds: re.inputArtifactVersionIds,
        })),
      })),
      publications: publications.map((p) => ({
        id: p.id,
        reconstructionManifestVersionId: p.reconstruction_manifest_version_id,
        payloadHash: p.payload_hash,
      })),
      outcomeVersions: outcomeVersions.map((ov) => ({
        id: ov.id,
        version: ov.version,
        state: ov.state,
        sourceArtifactVersionId: ov.source_artifact_version_id,
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
      attempt: primaryAttempt.attempt,
      attempts,
      executions: primaryAttempt.executions.map((re) => re.execution),
      publications,
      outcomeVersions,
      evaluations,
      lineageHash,
    };
  }

  /**
   * Reconstructs one attempt: its executions, commands, outputs, and inputs,
   * verifying every input artifact's cutoff eligibility and exact bytes.
   * Returns a ReconstructedAttempt; throws on any integrity violation.
   */
  private async reconstructAttempt(
    attempt: RunAttemptRecord,
    cutoffAt: string,
  ): Promise<ReconstructedAttempt> {
    const executions = await this.executionRepo.getExecutionsForAttempt(attempt.id);
    const reconstructed: ReconstructedExecution[] = [];

    for (const execution of executions) {
      const [commands, outputs, inputs] = await Promise.all([
        this.executionRepo.getCommandsForExecution(execution.id),
        this.executionRepo.getOutputsForExecution(execution.id),
        this.storageRepo.getExecutionInputs(execution.id),
      ]);

      const inputArtifactVersionIds: ArtifactVersionId[] = [];
      for (const input of inputs) {
        inputArtifactVersionIds.push(input.artifact_version_id);
        await this.verifyInputArtifact(input.artifact_version_id, cutoffAt);
      }

      reconstructed.push({
        execution,
        commands,
        outputs,
        inputArtifactVersionIds,
      });
    }

    return { attempt, executions: reconstructed };
  }

  /**
   * Verifies an input artifact's point-in-time cutoff eligibility and exact
   * SHA-256 bytes via the trusted ArtifactStore, per the storage foundation's
   * "reads used for reconstruction go through materializeVerified" rule.
   * Resolves if eligible and bytes verify; throws otherwise.
   */
  private async verifyInputArtifact(
    artifactVersionId: ArtifactVersionId,
    cutoffAt: string,
  ): Promise<void> {
    const version = await this.storageRepo.getArtifactVersion(artifactVersionId);
    if (!version) return;

    assertEvidenceEligible(version.available_from, cutoffAt, version.state);

    const verifyDestination = path.join(
      os.tmpdir(),
      `reconstruction-verify-${randomUUID()}`,
    );
    try {
      await this.artifactStore.materializeVerified(
        {
          organization_id: version.organization_id,
          content_sha256: version.content_sha256,
        },
        { sha256: version.content_sha256, byteLength: version.content_bytes },
        verifyDestination,
      );
    } finally {
      if (fs.existsSync(verifyDestination)) {
        fs.unlinkSync(verifyDestination);
      }
    }
  }
}
