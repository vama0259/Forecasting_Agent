/**
 * Purpose: Integration tests for outcome settlement and evaluation gating.
 * Responsibility: Assert that evaluations succeed only against SETTLED outcomes.
 * Inputs/outputs: Provisional vs Settled outcome records; evaluation persistence.
 * Excludes: Container runtime execution.
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
  PostgresOutcomeRepository,
  // repo
} from '../../src/adapters/postgres/postgres-outcome-repo.js';
import {
  PostgresEvaluationRepository,
  // repo
} from '../../src/adapters/postgres/postgres-evaluation-repo.js';
import {
  LocalArtifactStore,
  // store
} from '../../src/adapters/storage/local-artifact-store.js';
import type {
  ArtifactVersionId,
  ContractId,
  OrganizationId,
  PublicationId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type { CanonicalPlan } from '../../src/core/types/execution.js';

async function* singleChunk(data: Buffer): AsyncIterable<Uint8Array> {
  yield data;
}

describe('Postgres Outcome Settlement & Evaluation Gating', () => {
  const testDir = path.resolve(process.cwd(), 'data', 'test-outcome-settlement');
  let pool: PostgresPool;
  let storageRepo: PostgresStorageRepository;
  let outcomeRepo: PostgresOutcomeRepository;
  let evalRepo: PostgresEvaluationRepository;
  let artifactStore: LocalArtifactStore;
  let orgId: OrganizationId;
  let pubId: PublicationId;
  let groundTruthVersionId: ArtifactVersionId;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    pool = new PostgresPool();
    storageRepo = new PostgresStorageRepository(pool);
    outcomeRepo = new PostgresOutcomeRepository(pool);
    evalRepo = new PostgresEvaluationRepository(pool);
    artifactStore = new LocalArtifactStore(testDir);

    const org = await storageRepo.createOrganization({
      slug: `eval-test-org-${Date.now()}`,
      display_name: 'Evaluation Test Org',
    });
    orgId = org.id;

    const proj = await storageRepo.createProject({
      organization_id: orgId,
      slug: 'eval-proj',
      display_name: 'Evaluation Project',
    });

    const contract = await storageRepo.createContract({
      id: undefined as unknown as ContractId,
      organization_id: orgId,
      project_id: proj.id,
      version: 1,
      input_schema: {},
      output_schema: {},
      cutoff_policy: {},
      resolution_policy: {},
      evaluation_policy: {},
      status: 'FROZEN',
      contract_hash: '1'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });

    const principalRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Principal') RETURNING id`,
      [orgId],
    );
    const principalId = principalRes.rows[0]?.id as string;

    const run = await storageRepo.createRun({
      organization_id: orgId,
      project_id: proj.id,
      contract_id: contract.id,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });

    const plan: CanonicalPlan = {
      schema_version: 1,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      executions: [],
    };

    const attempt = await storageRepo.createRunAttempt({
      organization_id: orgId,
      run_id: run.id,
      attempt_number: 1,
      plan,
      plan_hash: '2'.repeat(64) as Sha256Hash,
    });

    const manifestBytes = Buffer.from(JSON.stringify({ run: run.id }));
    const manifestStaged = await artifactStore.stage(singleChunk(manifestBytes), orgId);
    const manifestCommitted = await artifactStore.commit(manifestStaged);

    const manifestArtifact = await storageRepo.createArtifact({
      organization_id: orgId,
      project_id: proj.id,
      kind: 'reconstruction_manifest',
      logical_name: 'manifest.json',
    });

    const manifestVersion = await storageRepo.createArtifactVersion({
      organization_id: orgId,
      artifact_id: manifestArtifact.id,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: manifestCommitted.content_sha256,
      content_bytes: manifestCommitted.content_bytes,
      media_type: 'application/json',
      storage_key: manifestCommitted.storage_key,
      available_from: new Date().toISOString(),
      retrieved_at: new Date().toISOString(),
    });

    const pub = await storageRepo.createPublication({
      organization_id: orgId,
      run_id: run.id,
      run_attempt_id: attempt.id,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      payload: { forecast: 100 },
      payload_hash: '4'.repeat(64) as Sha256Hash,
      reconstruction_manifest_version_id: manifestVersion.id,
    });
    pubId = pub.id;

    const gtBytes = Buffer.from('date,actual\n2026-08-21,95\n');
    const gtStaged = await artifactStore.stage(singleChunk(gtBytes), orgId);
    const gtCommitted = await artifactStore.commit(gtStaged);

    const gtArtifact = await storageRepo.createArtifact({
      organization_id: orgId,
      project_id: proj.id,
      kind: 'ground_truth',
      logical_name: 'actuals.csv',
    });

    const gtVersion = await storageRepo.createArtifactVersion({
      organization_id: orgId,
      artifact_id: gtArtifact.id,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: gtCommitted.content_sha256,
      content_bytes: gtCommitted.content_bytes,
      media_type: 'text/csv',
      storage_key: gtCommitted.storage_key,
      available_from: new Date().toISOString(),
      retrieved_at: new Date().toISOString(),
    });
    groundTruthVersionId = gtVersion.id;
  });

  afterAll(async () => {
    await pool.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rejects evaluation when outcome is PROVISIONAL', async () => {
    const outcome = await outcomeRepo.appendOutcomeVersion({
      organization_id: orgId,
      publication_id: pubId,
      state: 'PROVISIONAL',
      payload: { actual: 95 },
      source_artifact_version_id: groundTruthVersionId,
      resolver_version: 'v1.0.0',
    });

    await expect(
      evalRepo.createFinalEvaluation({
        organization_id: orgId,
        publication_id: pubId,
        outcome_version_id: outcome.id,
        definition_hash: '6'.repeat(64) as Sha256Hash,
        implementation_versions: { evaluator: '1.0.0' },
        metrics: { mape: 0.05 },
        baseline_metrics: { mape: 0.1 },
      }),
    ).rejects.toThrow('Cannot create final evaluation: outcome state is');
  });

  it('succeeds evaluation when outcome is SETTLED', async () => {
    const settledOutcome = await outcomeRepo.appendOutcomeVersion({
      organization_id: orgId,
      publication_id: pubId,
      state: 'SETTLED',
      payload: { actual: 95 },
      source_artifact_version_id: groundTruthVersionId,
      resolver_version: 'v1.0.0',
    });

    const evaluation = await evalRepo.createFinalEvaluation({
      organization_id: orgId,
      publication_id: pubId,
      outcome_version_id: settledOutcome.id,
      definition_hash: '7'.repeat(64) as Sha256Hash,
      implementation_versions: { evaluator: '1.0.0' },
      metrics: { mape: 0.05, rmse: 5.0 },
      baseline_metrics: { mape: 0.1, rmse: 10.0 },
    });

    expect(evaluation.outcome_version_id).toBe(settledOutcome.id);
  });
});
