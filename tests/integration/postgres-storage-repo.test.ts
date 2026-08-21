/**
 * Purpose: Integration tests for PostgresStorageRepository.
 * Responsibility: Verify persistence and retrieval of organizations, runs, artifacts.
 * Inputs/outputs: Database pool; assertions on persisted and queried entity records.
 * Excludes: Container runtime scheduling and sandbox execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import {
  PostgresStorageRepository,
  // repo
} from '../../src/adapters/postgres/postgres-storage-repo.js';
import type {
  ContractId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from '../../src/core/types/identifiers.js';

describe('PostgresStorageRepository Integration', () => {
  let pool: PostgresPool;
  let repo: PostgresStorageRepository;
  let orgId: OrganizationId;
  let projId: ProjectId;

  beforeAll(async () => {
    pool = new PostgresPool();
    repo = new PostgresStorageRepository(pool);

    const org = await repo.createOrganization({
      slug: `test-org-${Date.now()}`,
      display_name: 'Test Organization',
    });
    orgId = org.id;

    const proj = await repo.createProject({
      organization_id: orgId,
      slug: 'forecasting-project',
      display_name: 'Forecasting Project',
    });
    projId = proj.id;
  });

  afterAll(async () => {
    await pool.close();
  });

  it('creates and retrieves a forecast contract and run', async () => {
    const contract = await repo.createContract({
      id: undefined as unknown as ContractId,
      organization_id: orgId,
      project_id: projId,
      version: 1,
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      cutoff_policy: { max_delay_ms: 0 },
      resolution_policy: { type: 'ground_truth_csv' },
      evaluation_policy: { metrics: ['MAPE', 'RMSE'] },
      status: 'FROZEN',
      contract_hash: 'c'.repeat(64) as Sha256Hash,
      frozen_at: new Date().toISOString(),
    });

    const principalRes = await pool.query<{ id: string }>(
      `INSERT INTO principals (organization_id, display_name)
       VALUES ($1, 'Test Principal') RETURNING id`,
      [orgId],
    );
    const principalId = principalRes.rows[0]?.id;
    expect(principalId).toBeDefined();

    const run = await repo.createRun({
      organization_id: orgId,
      project_id: projId,
      contract_id: contract.id,
      requested_by: principalId as string,
      cutoff_at: '2026-08-21T00:00:00.000Z',
      resolve_after: '2026-08-22T00:00:00.000Z',
    });

    expect(run.state).toBe('OPEN');
    const fetched = await repo.getRun(run.id);
    expect(fetched?.id).toBe(run.id);
  });

  it('creates logical artifact and immutable versions', async () => {
    const artifact = await repo.createArtifact({
      organization_id: orgId,
      project_id: projId,
      kind: 'raw_input',
      logical_name: 'historical_series.csv',
    });

    const version = await repo.createArtifactVersion({
      organization_id: orgId,
      artifact_id: artifact.id,
      version: 1,
      state: 'AVAILABLE',
      content_sha256: 'a'.repeat(64) as Sha256Hash,
      content_bytes: 1024,
      media_type: 'text/csv',
      storage_key: '/data/artifacts/sha256/aa/' + 'a'.repeat(64),
      available_from: '2026-08-20T23:59:59.000Z',
      retrieved_at: '2026-08-20T23:59:59.000Z',
    });

    const fetchedVersion = await repo.getArtifactVersion(version.id);
    expect(fetchedVersion?.content_bytes).toBe(1024);
    expect(fetchedVersion?.state).toBe('AVAILABLE');
  });
});
