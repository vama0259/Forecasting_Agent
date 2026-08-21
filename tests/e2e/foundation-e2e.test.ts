/**
 * Purpose: End-to-end integration and lifecycle verification for Foundation.
 * Responsibility: Exercise complete flow from contract to run, eval, and backup.
 * Inputs/outputs: Database pool & Podman runtime; asserts end-to-end correctness.
 * Excludes: External network calls.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import {
  PostgresExecutionRepository,
  // repo
} from '../../src/adapters/postgres/postgres-execution-repo.js';
import {
  PostgresAuditSink,
  // sink
} from '../../src/adapters/postgres/postgres-audit-sink.js';
import {
  PostgresOutcomeRepository,
  // repo
} from '../../src/adapters/postgres/postgres-outcome-repo.js';
import {
  PostgresEvaluationRepository,
  // repo
} from '../../src/adapters/postgres/postgres-evaluation-repo.js';
import {
  PostgresWriteBarrier,
  // barrier
} from '../../src/adapters/postgres/postgres-write-barrier.js';
import {
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import {
  RootlessPodmanRuntime,
  // runtime
} from '../../src/adapters/podman/rootless-podman-runtime.js';
import { ArtifactStager } from '../../src/execution/artifact-stager.js';
import { OutputCollector } from '../../src/execution/output-collector.js';
import { ExecutionBroker } from '../../src/execution/execution-broker.js';
import {
  ReconstructionEngine,
  // engine
} from '../../src/app/reconstruction-engine.js';
import { BackupService } from '../../src/app/backup-service.js';
import { RestoreService } from '../../src/app/restore-service.js';
import { seedE2EEntities } from './e2e-fixtures.js';
import type {
  ArtifactVersionId,
  ExecutionId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type {
  AuthorizationPayload,
  CanonicalPlan,
  OutputDeclaration,
} from '../../src/core/types/execution.js';

describe('Foundation End-to-End Pipeline Tests', () => {
  const testDir = path.resolve(process.cwd(), 'data', 'test-e2e');
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let execRepo: PostgresExecutionRepository;
  let auditSink: PostgresAuditSink;
  let outcomeRepo: PostgresOutcomeRepository;
  let evalRepo: PostgresEvaluationRepository;
  let writeBarrier: PostgresWriteBarrier;
  let artifactStore: LocalArtifactStore;
  let runtime: RootlessPodmanRuntime;
  let broker: ExecutionBroker;
  let reconstruction: ReconstructionEngine;
  let backupService: BackupService;
  let restoreService: RestoreService;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    execRepo = new PostgresExecutionRepository(pool);
    auditSink = new PostgresAuditSink(pool);
    outcomeRepo = new PostgresOutcomeRepository(pool);
    evalRepo = new PostgresEvaluationRepository(pool);
    writeBarrier = new PostgresWriteBarrier(pool);
    artifactStore = new LocalArtifactStore(path.join(testDir, 'store'));
    runtime = new RootlessPodmanRuntime({ maxConcurrency: 2 });

    const stager = new ArtifactStager(artifactStore, {
      stagingBaseDir: path.join(testDir, 'staging'),
    });
    const collector = new OutputCollector(
      runtime,
      artifactStore,
      storageRepo,
      execRepo,
    );
    broker = new ExecutionBroker(runtime, execRepo, auditSink, stager, collector);

    reconstruction = new ReconstructionEngine(storageRepo, evalRepo, pool);
    backupService = new BackupService(writeBarrier, pool, path.join(testDir, 'store'));
    restoreService = new RestoreService(pool, path.join(testDir, 'store'));
  });

  afterAll(async () => {
    await pool.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('runs complete E2E forecasting flow from run to eval and backup', async () => {
    const seeded = await seedE2EEntities(pool, storageRepo, artifactStore);
    const { orgId, projId, principalId, contract, execContract, inputVersion } = seeded;

    // 1. Create run and attempt
    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: projId,
      contract_id: contract.id,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });

    const plan: CanonicalPlan = {
      schema_version: 1,
      contract_hash: contract.contract_hash,
      executions: [],
    };

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: run.id,
      attempt_number: 1,
      plan,
      plan_hash: 'p1'.repeat(32) as Sha256Hash,
    });

    // 2. Create and authorize execution
    const authHash = 'a1'.repeat(32) as Sha256Hash;
    const expiresAt = new Date(Date.now() + 60000).toISOString();

    const authPayload: AuthorizationPayload = {
      authorization_id: 'auth-e2e-1',
      organization_id: orgId,
      project_id: projId,
      run_id: run.id,
      run_attempt_id: attempt.id,
      execution_id: 'exec-e2e-placeholder' as ExecutionId,
      contract_id: contract.id,
      execution_contract_id: execContract.id,
      plan_hash: attempt.plan_hash,
      command_set_hash: 'cmd1'.repeat(16) as Sha256Hash,
      runtime_digest: 'alpine',
      platform_digest: 'linux/amd64',
      expires_at: expiresAt,
    };

    const execution = await execRepo.createExecutionWithAuthorization({
      execution: {
        organization_id: orgId,
        run_attempt_id: attempt.id,
        execution_kind: 'model_inference',
        execution_contract_id: execContract.id,
        authorization_hash: authHash,
        runtime_digest: 'alpine',
        platform_digest: 'linux/amd64',
      },
      authorization: {
        authorization_payload: authPayload,
        expires_at: expiresAt,
      },
    });

    // 3. Execute node via broker
    const completed = await broker.executeNode({
      executionId: execution.id,
      runAttemptId: attempt.id,
      organizationId: orgId,
      projectId: projId,
      executionContractId: execContract.id,
      authorizationHash: authHash,
      runtimeDigest: 'alpine',
      platformDigest: 'linux/amd64',
      resourcePolicy: execContract.resource_policy,
      inputs: [
        {
          artifactVersion: inputVersion,
          targetPath: 'inputs/history.csv',
          cutoffAt: run.cutoff_at,
        },
      ],
      commands: [
        {
          argv: [
            '/bin/sh',
            '-c',
            'echo "date,prob" > /outputs/forecast.csv && ' +
              'echo "2026-08-22,0.78" >> /outputs/forecast.csv',
          ],
          working_directory: '/workspace',
          environment: {},
          timeout_ms: 15000,
        },
      ],
      outputDeclarations:
        execContract.output_declarations as unknown as readonly OutputDeclaration[],
    });

    expect(completed.state).toBe('COMPLETED');
    expect(completed.exit_code).toBe(0);

    // 4. Publish forecast output
    const outputs = await pool.query<{ artifact_version_id: string }>(
      'SELECT artifact_version_id FROM execution_outputs ' + 'WHERE execution_id = $1',
      [execution.id],
    );
    const forecastVersionId = outputs.rows[0]?.artifact_version_id;
    expect(forecastVersionId).toBeDefined();

    const publication = await storageRepo.createPublication({
      organization_id: orgId,
      run_id: run.id,
      run_attempt_id: attempt.id,
      contract_hash: contract.contract_hash,
      payload: { forecast: 'output' },
      payload_hash: 'ph1'.repeat(21) as Sha256Hash,
      reconstruction_manifest_version_id: forecastVersionId as ArtifactVersionId,
    });
    expect(publication.id).toBeDefined();

    // 5. Observe and settle outcome
    const outcome = await outcomeRepo.appendOutcomeVersion({
      organization_id: orgId,
      publication_id: publication.id,
      state: 'SETTLED',
      payload: { actual_value: 110, event_occurred: true },
      source_artifact_version_id: forecastVersionId as ArtifactVersionId,
      resolver_version: '1.0.0',
    });
    expect(outcome.state).toBe('SETTLED');

    // 6. Evaluate forecast
    const evalRun = await evalRepo.createFinalEvaluation({
      organization_id: orgId,
      publication_id: publication.id,
      outcome_version_id: outcome.id,
      definition_hash: 'def1'.repeat(16) as Sha256Hash,
      implementation_versions: { evaluator: '1.0.0' },
      metrics: { brier_score: 0.0484 },
      baseline_metrics: {},
    });
    expect(evalRun.id).toBeDefined();

    // 7. Reconstruct run and verify lineage
    const reconstructed = await reconstruction.reconstructRun(run.id);
    expect(reconstructed.run.id).toBe(run.id);
    expect(reconstructed.executions).toHaveLength(1);
    expect(reconstructed.publications).toHaveLength(1);
    expect(reconstructed.evaluations).toHaveLength(1);
    expect(reconstructed.lineageHash).toBeDefined();

    // 8. Point-in-time backup
    const backupDir = path.join(testDir, 'backup-output');
    const manifest = await backupService.createBackup(backupDir);
    expect(manifest.schema_version).toBe(1);
    expect(manifest.artifacts.length).toBeGreaterThanOrEqual(2);

    // 9. Point-in-time restore
    await restoreService.restore(backupDir);

    const postRestoreReconstruction = await reconstruction.reconstructRun(run.id);
    expect(postRestoreReconstruction.lineageHash).toBe(reconstructed.lineageHash);
  });
});
