/**
 * Purpose: Integration tests verifying publication uniqueness and row locking.
 * Responsibility: Assert that concurrent publication attempts for one run serialize.
 * Inputs/outputs: Concurrent worker promises; exactly one winner assertion.
 * Excludes: Container runtime execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import type {
  ArtifactVersionId,
  ContractId,
  OrganizationId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';
import type { CanonicalPlan } from '../../src/core/types/execution.js';

describe('Postgres Publication Race Integration', () => {
  let pool: PostgresPool;
  let repo: PostgresStorageRepository;
  let orgId: OrganizationId;
  let runId: RunId;
  let runAttemptId: RunAttemptId;
  let manifestVersionId: ArtifactVersionId;

  beforeAll(async () => {
    pool = new PostgresPool();
    repo = new PostgresStorageRepository(pool);

    const org = await repo.createOrganization({
      slug: `pub-test-org-${Date.now()}`,
      display_name: 'Publication Test Org',
    });
    orgId = org.id;

    const proj = await repo.createProject({
      organization_id: orgId,
      slug: 'pub-proj',
      display_name: 'Publication Project',
    });

    const contract = await repo.createContract({
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

    const run = await repo.createRun({
      organization_id: orgId,
      project_id: proj.id,
      contract_id: contract.id,
      requested_by: principalId,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });
    runId = run.id;

    const plan: CanonicalPlan = {
      schema_version: 1,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      executions: [],
    };

    const attempt = await repo.createRunAttempt({
      organization_id: orgId,
      run_id: runId,
      attempt_number: 1,
      plan,
      plan_hash: '2'.repeat(64) as Sha256Hash,
    });
    runAttemptId = attempt.id;

    const artifact = await repo.createArtifact({
      organization_id: orgId,
      project_id: proj.id,
      kind: 'reconstruction_manifest',
      logical_name: 'manifest.json',
    });

    const manifestVersion = await repo.createArtifactVersion({
      organization_id: orgId,
      artifact_id: artifact.id,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: '3'.repeat(64) as Sha256Hash,
      content_bytes: 512,
      media_type: 'application/json',
      storage_key: '/data/artifacts/sha256/33/' + '3'.repeat(64),
      available_from: new Date().toISOString(),
      retrieved_at: new Date().toISOString(),
    });
    manifestVersionId = manifestVersion.id;
  });

  afterAll(async () => {
    await pool.close();
  });

  it('allows only 1 winner when workers publish for same run_id', async () => {
    const pubParams = {
      organization_id: orgId,
      run_id: runId,
      run_attempt_id: runAttemptId,
      contract_hash: '1'.repeat(64) as Sha256Hash,
      payload: { forecast: [1, 2, 3] },
      payload_hash: '4'.repeat(64) as Sha256Hash,
      reconstruction_manifest_version_id: manifestVersionId,
    };

    const worker1 = repo.createPublication(pubParams);
    const worker2 = repo.createPublication(pubParams);

    const results = await Promise.allSettled([worker1, worker2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
